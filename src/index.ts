import { Bot, Context } from 'grammy';
import OpenAI from 'openai';
import { createClient } from 'redis';

import {
    homepage, license, repository, version,
} from '../package.json';
import env from './utils/env';
import prisma from './utils/prisma';
import xssStringify from './utils/xssStringify';

const expireTime = 60 * 60 * 24 * 7; // 7 days

// redis
const redis = createClient({
    url: env.redis,
});

redis.on('error', (err: any) => console.log('Redis Client Error', err));

redis.connect();

// openai instance
const openai = new OpenAI({ apiKey: env.openaiAPIKey });

const bot = new Bot(env.botToken);

bot.use((ctx, next) => {
    console.log(ctx.message);
    if (ctx.message && ctx.chat?.type !== 'private' && ctx.message.text?.startsWith('/')) {
        ctx.reply('Please send me a private message to use this bot.', {
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
        });
        return;
    }
    next();
});

bot.command(['help', 'about', 'settings', 'privacy'], async (ctx) => {
    const params = ctx.message!.text?.split(' ')[1]?.split('_');
    if (!params || params.length < 1) {
        ctx.reply(`👋 Hi, I can summearize some messages of a channel.

<b>Usage</b>
<blockquote>1. Send me a private message /start
2. Forwards messages from a channel to me. Make sure the first message forwarded to me is from the channel you want to summarize, and not a forwarded message.
3. Send me /finish to stop sending messages and summarize the messages I have received.
</blockquote>

<b>About the bot</b>
<blockquote>Version <code>${version}</code>
Get code from <code>${repository.url}</code>, <code>${license}</code> lisense
<a href="${homepage}">Learn more</a></blockquote>`, {
            parse_mode: 'HTML',
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
        });
    }
});

// start log
bot.command('start', async (ctx) => {
    // if has limited user
    if (env.hasUserLimitation) {
        const whitelist = await prisma.userWhiteList.findUnique({
            where: {
                userId: ctx.from!.id,
            },
        });
        if (!whitelist) {
            ctx.reply('Sorry, you are not allowed to use this bot.', {
                reply_parameters: {
                    message_id: ctx.message!.message_id,
                    allow_sending_without_reply: true,
                },
            });
            return;
        }
    }

    // save action to redis
    await redis.set(`action:${ctx.from!.id}`, 'gather_messages', { EX: expireTime });

    // send message
    ctx.reply('Please forward messages from the channel you want to summarize. The first forwarded message should be from the channel you want to summarize. ', {
        reply_parameters: {
            message_id: ctx.message!.message_id,
            allow_sending_without_reply: true,
        },
    });
});

// check current action
async function checkAction(ctx: Context) {
    // get action from redis
    const action = await redis.get(`action:${ctx.from!.id}`);

    if (action !== 'gather_messages') {
        // not in gather_messages action
        ctx.reply('Please send me /start to start sending messages.', {
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
        });

        return false;
    }

    return true;
}

bot.on('message:forward_origin', async (ctx) => {
    // check action
    if (!await checkAction(ctx)) {
        return;
    }

    // only text messages or messages with captions are supported
    const messageText = ctx.message.text || ctx.message.caption || null;
    if (!messageText) {
        ctx.reply('Currently only text messages or messages with captions are supported. ', {
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
        });
        return;
    }

    // don't support messages forwarded by the channel
    // get channel information
    const channelInfoCache = await redis.get(`action_channel:${ctx.from!.id}`);

    // message must be from channel
    if (ctx.message.forward_origin.type !== 'channel') {
        ctx.reply('The message should be from a channel.', {
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
        });

        return;
    }

    // message must not from other chats
    if (channelInfoCache && ctx.message.forward_origin.chat.id !== JSON.parse(channelInfoCache).id) {
        ctx.reply('The message should be from the same channel.', {
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
        });

        return;
    }

    // save message to redis
    const messageToSave = {
        text: messageText,
        message_id: ctx.message.forward_origin.message_id,
    };
    await redis.rPush(`messages:${ctx.from!.id}`, JSON.stringify(messageToSave));

    if (!channelInfoCache) {
        const channelInfo = await ctx.api.getChat(ctx.message!.forward_origin.chat.id);

        // save channel information to redis
        await redis.set(`action_channel:${ctx.from!.id}`, JSON.stringify(channelInfo), { EX: expireTime });

        // send message
        ctx.reply(`Message received and channel information saved. \n\nChannel: [${xssStringify((channelInfo as any).title, 'Markdown')}](https://t.me/c/${channelInfo.id.toString()
            .replace('-100', '')}/${ctx.message.forward_origin.message_id}) \n\nSend more messages to summarize or send /finish.`, {
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
            parse_mode: 'Markdown',
        });

        return;
    }

    // send message
    ctx.reply('Message received. \n\nSend more messages to summarize or send /finish.', {
        reply_parameters: {
            message_id: ctx.message!.message_id,
            allow_sending_without_reply: true,
        },
    });
});

bot.command('finish', async (ctx) => {
    // check action
    if (!await checkAction(ctx)) {
        return;
    }

    try {
        // get messages from redis
        const messages = await redis.lRange(`messages:${ctx.from!.id}`, 0, -1);

        if (messages.length < 1) {
            ctx.reply('No messages received. Please forward messages from the channel you want to summarize.', {
                reply_parameters: {
                    message_id: ctx.message!.message_id,
                    allow_sending_without_reply: true,
                },
            });
            return;
        }

        // get channel information
        const channelInfo = JSON.parse(await redis.get(`action_channel:${ctx.from!.id}`) ?? '{}');

        console.log(channelInfo);

        // send message
        const message = await ctx.reply('Summarizing messages...', {
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
        });

        // sort, convert to object
        const messagesObject = messages.map((m) => JSON.parse(m));

        // moderation
        if (env.moderation) {
            await Promise.all(messagesObject.map(async (m, i) => {
                if (m.text || m.caption) {
                    const response = await openai.moderations.create({
                        input: m.text || m.caption,
                    });

                    if (response.results[0].flagged) {
                        messagesObject[i].flagged = true;
                    }
                }
            }));
        }

        // generate query text
        const query = JSON.stringify(messagesObject.map((m: any) => {
            if (m.flagged) return {};
            if (m.text || m.caption) {
                return {
                    text: m.text || m.caption,
                    id: m.message_id,
                };
            }
            return {};
        }).filter((m: any) => Object.keys(m).length > 0));

        console.log(query);

        const prompt = `This is a summarizer bot. Summarize the following messages from Telegram channel.
Instructions: 
1. Below are messages from the channel in json format. Each provided message with \`text\` and \`id\` fields.
2. Not every message should be summarized. Only summarize messages that are important, funny or have their own value to be summarized.
3. Use summary groups to group messages that are related to each other. One summary group can contain one or multiple messages. 
   It's recommended group contains < 4 messages, and return no more than 6 groups. Longer messages have more chance to be selected.
4. A summary group should have its own title. The title should be a short sentence (no more than 10 words) that describes the content of the summary group exactly, and as humerous as possible. 
   Example: "Elon Musk's attitude towards Dogecoin", "A bad day starts with the drop of a coffee cup".
5. Each message in the summary group should also have a short sentence (no more than 15 words) that describes the content of the message exactly, and as humerous as possible.
   Example: "How he (Elon Musk) explains the Dogecoin", "The Dogecoin price prediction".
6. A message can only be used ONLY ONCE among all summary groups. DO NOT REUSE the same message in different/same summary groups.
6. Titles should be unique and should not be repeated. 
7. TITLES SHOULD BE WRITTEN IN THE LANGUAGE THAT THE MESSAGES PROVIDED WERE WRITTEN IN.
8. Respond to the message with the summary groups in array json format. Each summary group should have a title and messages. Each message should have a id field, 
   which is the same as the message id we provided. 
   If the format is incorrect, the bot will not be able to understand the response.
   Input example:
   [{text: xxx, id: 490}, {text: xxx, id: 491}, {text: xxx, id: 492}, {text: xxx, id: 493}, {text: xxx, id: 494}, {text: xxx, id: 495}, ]
   Response example:
{ 
    "result": [{
        "title": "Elon Musk's attitude towards Dogecoin",
        "messages": [
            {
                "title": "How he explains the Dogecoin",
                "id": 490
            },
            {
                "title": "The Dogecoin price prediction",
                "id": 494
            }
        ]
    }, {
        "title": "A bad day starts with the drop of a coffee cup",
        "messages": [
            {
                "title": "The coffee cup drop",
                "id": 493
            }
        ]
    }]
}
Heres some information about the channel, can be used to generate better summaries:
Channel Title: ${(channelInfo as any)?.title}
Channel Description: ${(channelInfo as any)?.description}`;

        // query openai
        let wrong = false;
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 4096,
            temperature: 0.4,
            response_format: {
                type: 'json_object',
            },
            n: 1,
            messages: [
                {
                    role: 'system',
                    content: prompt,
                },
                {
                    role: 'user',
                    content: query,
                },
            ],
            user: ctx.from!.id.toString(),
        }).catch((err) => {
            wrong = true;
            console.error(err);
            if (err?.error?.code === 'context_length_exceeded') {
                ctx.reply('Error: The messages are too long. Please remove some messages and try again.', {
                    reply_parameters: {
                        message_id: message.message_id,
                        allow_sending_without_reply: true,
                    },
                });
            }
        });

        if (wrong || !response) return;

        console.log(response);

        const summaryTextRaw = response.choices[0].message.content;

        console.log(summaryTextRaw);

        if (!summaryTextRaw) {
            ctx.reply('Error: Response format is empty.', {
                reply_parameters: {
                    message_id: message.message_id,
                    allow_sending_without_reply: true,
                },
            });
            return;
        }
        let summaryTextJson: { title: string, messages: { title: string, id: number }[] }[];
        try {
            const summaryTextJsonRaw = JSON.parse(summaryTextRaw);
            summaryTextJson = summaryTextJsonRaw.result;
        } catch (e) {
            ctx.reply('Error: Response format is incorrect. ', {
                reply_parameters: {
                    message_id: message.message_id,
                    allow_sending_without_reply: true,
                },
            });
            return;
        }

        console.log(summaryTextJson, response.usage?.total_tokens);

        if (summaryTextJson.length === 0) {
            ctx.reply('AI have not generate any summary.', {
                reply_parameters: {
                    message_id: message.message_id,
                    allow_sending_without_reply: true,
                },
            });
            return;
        }

        // send message
        const summaryText = summaryTextJson.map((s) => {
            const messagesList = s.messages.map((m) => `- [${xssStringify(m.title, 'Markdown')}](https://t.me/c/${String((channelInfo as any).id).replace('-100', '')}/${m.id})`).join('\n');
            return `• *${xssStringify(s.title, 'Markdown')}*\n\n${messagesList}`;
        });

        ctx.reply(summaryText.join('\n\n'), {
            parse_mode: 'Markdown',
            reply_parameters: {
                message_id: message.message_id,
                allow_sending_without_reply: true,
            },
        });

        ctx.api.deleteMessage(message.chat.id, message.message_id);

        // log
        await prisma.history.create({
            data: {
                userId: ctx.from!.id,
                targetChannelId: (channelInfo as any).id,
                tokenSpent: response.usage?.total_tokens ?? 0,
                date: Math.floor(Date.now() / 1000),
            },
        });

        // delete messages
        await redis.del(`messages:${ctx.from!.id}`);
        await redis.del(`action_channel:${ctx.from!.id}`);
        await redis.del(`action:${ctx.from!.id}`);
    } catch (e) {
        console.log(e);
        ctx.reply('Unexpected error. Please try again later.', {
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
        });
    }
});

// cancel
bot.command('cancel', async (ctx) => {
    // delete messages
    await redis.del(`messages:${ctx.from!.id}`);
    await redis.del(`action_channel:${ctx.from!.id}`);
    await redis.del(`action:${ctx.from!.id}`);

    // send message
    ctx.reply('Action canceled.', {
        reply_parameters: {
            message_id: ctx.message!.message_id,
            allow_sending_without_reply: true,
        },
    });
});

// init bot
bot.command('init', async (ctx) => {
    // add user to whitelist if no user exists in the whitelist
    if (env.hasUserLimitation) {
        const count = await prisma.userWhiteList.count();
        if (count < 1) {
            await prisma.userWhiteList.create({
                data: {
                    userId: ctx.from!.id,
                    canPromoteOthers: true,
                },
            });
            ctx.reply('User added to whitelist');
        }
    }
});

// view log
bot.command('log', async (ctx) => {
    // check permission
    const whitelist = await prisma.userWhiteList.findUnique({
        where: {
            userId: ctx.from!.id,
            canPromoteOthers: true,
        },
    });

    if (!whitelist) {
        ctx.reply('You do not have permission to view logs.', {
            reply_parameters: {
                message_id: ctx.message!.message_id,
                allow_sending_without_reply: true,
            },
        });

        return;
    }

    // get history
    const history = await prisma.history.findMany({
        where: {
            userId: ctx.from!.id,
        },
        orderBy: {
            date: 'desc',
        },
        take: 5,
    });

    // get token usage
    const tokenUsage = history.reduce((a, b) => a + b.tokenSpent, 0);
    const totalTokenUsage = await prisma.history.aggregate({
        _sum: {
            tokenSpent: true,
        },
    });

    // send message
    ctx.reply(`History:

${history.map((h) => {
        const date = new Date(Number(h.date) * 1000);
        return `Channel: [${h.targetChannelId}](https://t.me/c/${h.targetChannelId.toString().replace('-100', '')})
Date: ${date.toISOString()}
Token spent: ${h.tokenSpent}`;
    }).join('\n\n')}
Total token usage: ${tokenUsage}/${totalTokenUsage._sum?.tokenSpent ?? 0}`, {
        parse_mode: 'Markdown',
        reply_parameters: {
            message_id: ctx.message!.message_id,
            allow_sending_without_reply: true,
        },
    });
});

bot.start({
    allowed_updates: ['message'],
});

bot.api.setMyCommands([
    {
        command: 'start',
        description: 'Start the bot',
    },
    {
        command: 'finish',
        description: 'Finish sending messages',
    },
    {
        command: 'cancel',
        description: 'Cancel current action',
    },
    {
        command: 'log',
        description: 'View log',
    },
    {
        command: 'init',
        description: 'Init bot',
    },
    {
        command: 'help',
        description: 'Get help',
    },
]);

export default bot;
export { redis };
