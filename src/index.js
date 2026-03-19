import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits
} from "discord.js";
import OpenAI from "openai";
import { commands } from "./commands.js";
import { config } from "./config.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const groq = new OpenAI({
  apiKey: config.groqApiKey,
  baseURL: config.groqBaseUrl
});

const conversationState = new Map();
const maxConversationTurns = 10;
const specialMentionNames = ["roses", "anna"];
const specialMentionIds = {
  anna: config.annaUserId,
  roses: config.rosesUserId
};

function getConversationKey(interaction) {
  const guildId = interaction.guildId || "dm";
  return `${guildId}:${interaction.channelId}:${interaction.user.id}`;
}

function chunkText(text, maxLength = 1900) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength);

    if (splitIndex === -1) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }

    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function isBeautyQuestion(prompt) {
  return /(?:siapa|yang).*(?:ganteng|cantik)|(?:ganteng|cantik).*(?:siapa|yang)/i.test(
    prompt
  );
}

function isRandomWakeRequest(prompt) {
  return (
    /\b(random|siapa pun|satu orang|satu member|seseorang)\b/i.test(prompt) ||
    /\b(pilih|pilihin|ambil|cariin)\b.*\b(member|orang)\b/i.test(prompt) ||
    /\b(tag|mention|panggil)\b.*\b(random|orang|member|seseorang)\b/i.test(prompt)
  );
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractActionRequest(prompt) {
  const match = prompt.match(
    /\b(tag|mention|panggil|suruh)\s+(?:si\s+)?([^\s]+)(?:\s+(.+))?/i
  );

  if (!match) {
    return null;
  }

  return {
    action: match[1].toLowerCase(),
    target: match[2].trim(),
    rest: (match[3] || "").trim()
  };
}

function scoreCandidate(candidate, target) {
  if (candidate === target) {
    return 4;
  }

  if (candidate.startsWith(target)) {
    return 3;
  }

  if (candidate.includes(target) || target.includes(candidate)) {
    return 2;
  }

  return 0;
}

async function resolveSingleMention(guild, name) {
  const configuredId = specialMentionIds[name.toLowerCase()];

  if (configuredId) {
    return `<@${configuredId}>`;
  }

  if (!guild) {
    return `@${name}`;
  }

  await guild.members.fetch();

  const normalizedTarget = normalizeName(name);
  let bestMember = null;
  let bestScore = 0;

  guild.members.cache.forEach((entry) => {
    const candidates = [
      entry.user.username,
      entry.user.globalName,
      entry.displayName
    ]
      .filter(Boolean)
      .map((value) => normalizeName(value));

    for (const candidate of candidates) {
      const score = scoreCandidate(candidate, normalizedTarget);

      if (score > bestScore) {
        bestMember = entry;
        bestScore = score;
      }
    }
  });

  return bestMember ? `<@${bestMember.id}>` : `@${name}`;
}

async function pickRandomMemberMention(channel, guild, excludedUserIds = []) {
  const cachedChannelMembers =
    channel && "members" in channel && channel.members
      ? channel.members.filter((entry) => {
          if (entry.user.bot) {
            return false;
          }

          return !excludedUserIds.includes(entry.id);
        })
      : null;

  if (cachedChannelMembers && cachedChannelMembers.size > 0) {
    const randomMember = cachedChannelMembers.random();
    return randomMember ? `<@${randomMember.id}>` : null;
  }

  if (!guild) {
    return null;
  }

  await guild.members.fetch();

  const members = guild.members.cache.filter((entry) => {
    if (entry.user.bot) {
      return false;
    }

    return !excludedUserIds.includes(entry.id);
  });

  if (members.size === 0) {
    return null;
  }

  const randomMember = members.random();
  return randomMember ? `<@${randomMember.id}>` : null;
}

function extractRandomActionText(prompt) {
  const cleanedPrompt = prompt
    .replace(/\b(pilih|pilihin|ambil|cariin)\b/gi, "")
    .replace(/\b(satu|1)\b/gi, "")
    .replace(/\b(member|orang|seseorang|random|siapa\s+pun)\b/gi, "")
    .replace(/\b(yang\s+disini|di\s+sini|disini)\b/gi, "")
    .replace(/\b(terus|lalu|buat|untuk)\b/gi, " ")
    .replace(/[,:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const directActionMatch = cleanedPrompt.match(
    /\b(?:suruh|panggil|tag|mention)\b\s+(.+)$/i
  );

  if (directActionMatch?.[1]) {
    return directActionMatch[1]
      .replace(/\b(dia|orangnya|membernya)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  return cleanedPrompt
    .replace(/\b(dia|orangnya|membernya)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveNamedMentions(guild) {
  const mentions = [];

  for (const name of specialMentionNames) {
    mentions.push(await resolveSingleMention(guild, name));
  }

  return mentions;
}

async function getPriorityAnswer(prompt, guild, channel) {
  if (isRandomWakeRequest(prompt)) {
    const mention = await pickRandomMemberMention(
      channel,
      guild,
      client.user ? [client.user.id] : []
    );

    if (mention) {
      const actionText = extractRandomActionText(prompt) || "bangun woy";

      return `${mention} ${actionText}`.trim();
    }

    return "Aku tidak menemukan member yang bisa di-tag di sini.";
  }

  const actionRequest = extractActionRequest(prompt);

  if (actionRequest) {
    const mention = await resolveSingleMention(guild, actionRequest.target);
    const cleanedPrompt = actionRequest.rest.trim();

    if (cleanedPrompt) {
      return `${mention} ${cleanedPrompt}`.trim();
    }

    return `${mention}`;
  }

  if (isBeautyQuestion(prompt)) {
    const mentions = await resolveNamedMentions(guild);
    return `Yang paling ganteng dan cantik di sini jelas ${mentions.join(" dan ")}.`;
  }

  return null;
}

async function handleChat(interaction) {
  await interaction.deferReply();

  const prompt = interaction.options.getString("prompt", true);
  const conversationKey = getConversationKey(interaction);
  const priorityAnswer = await getPriorityAnswer(
    prompt,
    interaction.guild,
    interaction.channel
  );
  const answer =
    priorityAnswer || (await generateAnswer(conversationKey, prompt));

  const chunks = chunkText(answer);

  await interaction.editReply(chunks[0]);

  for (const chunk of chunks.slice(1)) {
    await interaction.followUp(chunk);
  }
}

async function generateAnswer(conversationKey, prompt) {
  const history = conversationState.get(conversationKey) || [];
  const messages = [
    {
      role: "system",
      content: config.systemPrompt
    },
    ...history,
    {
      role: "user",
      content: prompt
    }
  ];

  const response = await groq.chat.completions.create({
    model: config.groqModel,
    messages
  });

  const answer =
    response.choices[0]?.message?.content?.trim() ||
    "Maaf, aku belum bisa menghasilkan jawaban untuk pesan itu.";

  const updatedHistory = [
    ...history,
    {
      role: "user",
      content: prompt
    },
    {
      role: "assistant",
      content: answer
    }
  ].slice(-maxConversationTurns * 2);

  conversationState.set(conversationKey, updatedHistory);

  return answer;
}

async function handleReset(interaction) {
  const conversationKey = getConversationKey(interaction);
  conversationState.delete(conversationKey);

  await interaction.reply({
    content: "Riwayat chat AI untuk channel ini sudah di-reset.",
    ephemeral: true
  });
}

client.once(Events.ClientReady, async (readyClient) => {
  readyClient.user.setPresence({
    activities: [
      {
        name: "Eryx Studio",
        type: ActivityType.Listening
      }
    ],
    status: "online"
  });

  console.log(`Bot online as ${readyClient.user.tag}`);
  console.log(`Loaded ${commands.length} slash commands.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === "chat") {
      await handleChat(interaction);
      return;
    }

    if (interaction.commandName === "reset") {
      await handleReset(interaction);
    }
  } catch (error) {
    console.error("Failed to handle interaction:", error);

    const message =
      "Terjadi error saat memproses permintaan. Coba lagi sebentar lagi.";

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: message,
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: message,
      ephemeral: true
    });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !client.user) {
    return;
  }

  const mentionPattern = new RegExp(`^<@!?${client.user.id}>`);
  let isReplyToBot = false;

  if (message.reference?.messageId) {
    if (message.mentions.repliedUser?.id === client.user.id) {
      isReplyToBot = true;
    } else {
      try {
        const referencedMessage = await message.fetchReference();
        isReplyToBot = referencedMessage.author?.id === client.user.id;
      } catch (error) {
        isReplyToBot = false;
      }
    }
  }

  const startsWithMention = mentionPattern.test(message.content.trim());

  if (!startsWithMention && !isReplyToBot) {
    return;
  }

  const prompt = startsWithMention
    ? message.content.replace(mentionPattern, "").trim()
    : message.content.trim();

  if (!prompt) {
    await message.reply(
      "Tulis pertanyaan setelah mention ya. Contoh: `@Eryx Studio bantu bikin caption produk`"
    );
    return;
  }

  try {
    await message.channel.sendTyping();

    const conversationKey = getConversationKey({
      guildId: message.guildId,
      channelId: message.channelId,
      user: message.author
    });

    const priorityAnswer = await getPriorityAnswer(
      prompt,
      message.guild,
      message.channel
    );
    const answer =
      priorityAnswer || (await generateAnswer(conversationKey, prompt));
    const chunks = chunkText(answer);

    await message.reply(chunks[0]);

    for (const chunk of chunks.slice(1)) {
      await message.channel.send(chunk);
    }
  } catch (error) {
    console.error("Failed to handle mention message:", error);
    await message.reply(
      "Terjadi error saat memproses pesan kamu. Coba lagi sebentar lagi."
    );
  }
});

client.login(config.discordToken);
