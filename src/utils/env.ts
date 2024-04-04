import dotenv from 'dotenv';

dotenv.config();

const env = {
    botToken: process.env.BOT_TOKEN as string,
    redis: process.env.REDIS_URL as string,
    hasUserLimitation: process.env.HAS_USER_LIMITATION === 'True',
    openaiAPIKey: process.env.OPENAI_API_KEY as string,
    moderation: process.env.MODERATION === 'True',
};

export default env;
