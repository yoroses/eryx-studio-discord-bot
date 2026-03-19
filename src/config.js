import dotenv from "dotenv";

dotenv.config();

const requiredVars = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "GROQ_API_KEY"];

const missingVars = requiredVars.filter((key) => !process.env[key]);

if (missingVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingVars.join(", ")}`
  );
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordGuildId: process.env.DISCORD_GUILD_ID || "",
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  groqBaseUrl: "https://api.groq.com/openai/v1",
  annaUserId: process.env.ANNA_USER_ID || "",
  rosesUserId: process.env.ROSES_USER_ID || "",
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    "Kamu adalah asisten Discord yang ramah, membantu, dan menjawab dengan jelas."
};
