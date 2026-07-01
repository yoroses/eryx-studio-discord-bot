import dotenv from "dotenv";

dotenv.config();

const llmApiKey = process.env.ANTHROPIC_API_KEY;
const llmModel = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
const llmMaxTokens = Number(process.env.CLAUDE_MAX_TOKENS || 1024);

const requiredVars = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "ANTHROPIC_API_KEY"];
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
  llmApiKey,
  llmModel,
  llmMaxTokens,
  replyDelayMs: Number(process.env.REPLY_DELAY_MS || 1500),
  selfCheckEnabled: process.env.SELF_CHECK_ENABLED !== "false",
  strictFactualMode: process.env.STRICT_FACTUAL_MODE !== "false",
  askClarifyFirstMode: process.env.ASK_CLARIFY_FIRST_MODE !== "false",
  roleAwareMentionMode: process.env.ROLE_AWARE_MENTION_MODE !== "false",
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    "Kamu adalah asisten Discord yang ramah, membantu, dan akurat. Selalu jawab dalam bahasa Indonesia kecuali diminta lain. Gunakan konteks percakapan sebelumnya saat menjawab. Jika pesan user adalah lanjutan dari konteks sebelumnya, sambungkan jawaban dengan konteks itu. Jika konteks tidak cukup jelas, ajukan pertanyaan klarifikasi singkat daripada menebak. Utamakan jawaban yang relevan, valid, dan tidak keluar topik."
};
