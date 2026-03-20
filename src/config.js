import dotenv from "dotenv";

dotenv.config();

const llmApiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;
const llmModel = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

const requiredVars = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID"];
const missingVars = requiredVars.filter((key) => !process.env[key]);

if (!llmApiKey) {
  missingVars.push("GEMINI_API_KEY");
}

if (missingVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingVars.join(", ")}`
  );
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordGuildId: process.env.DISCORD_GUILD_ID || "",
  llmApiKey,
  llmModel,
  llmBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
  annaUserId: process.env.ANNA_USER_ID || "",
  rosesUserId: process.env.ROSES_USER_ID || "",
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    "Kamu adalah asisten Discord yang ramah, membantu, dan menjawab dengan jelas."
};
