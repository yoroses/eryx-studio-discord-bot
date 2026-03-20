import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  entersState,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  getVoiceConnection
} from "@discordjs/voice";
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits
} from "discord.js";
import { spawn } from "node:child_process";
import OpenAI from "openai";
import play from "play-dl";
import ytdl from "@distube/ytdl-core";
import { commands } from "./commands.js";
import { config } from "./config.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const llm = new OpenAI({
  apiKey: config.llmApiKey,
  baseURL: config.llmBaseUrl
});

const conversationState = new Map();
const maxConversationTurns = 10;
const voicePlayers = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logVoice(message, details = null) {
  if (details) {
    console.log(`[voice] ${message}`, details);
    return;
  }

  console.log(`[voice] ${message}`);
}

function getUserFacingErrorMessage(error) {
  if (error?.status === 429) {
    return "Kuota AI lagi kena limit sementara. Coba lagi beberapa saat lagi.";
  }

  if (error?.status === 401 || error?.status === 403) {
    return "API key AI tidak valid atau belum punya akses ke model yang dipakai.";
  }

  return "Terjadi error saat memproses permintaan. Coba lagi sebentar lagi.";
}

function getConversationKey(interaction) {
  const guildId = interaction.guildId || "dm";
  return `${guildId}:${interaction.channelId}:${interaction.user.id}`;
}

function getVoiceChannelFromMember(member) {
  return member?.voice?.channel || null;
}

async function resolveGuildMember(guild, memberLike) {
  if (!guild || !memberLike?.id) {
    return memberLike || null;
  }

  try {
    return await guild.members.fetch(memberLike.id);
  } catch (error) {
    return memberLike || null;
  }
}

function extractRequestedVoiceChannelName(prompt) {
  const match = prompt.match(
    /\b(?:join|masuk)\b.*\b(?:vc|voice|voice channel)\b\s+(.+)$/i
  );

  return match?.[1]?.trim() || "";
}

async function resolveRequestedVoiceChannel(guild, prompt) {
  const channelName = extractRequestedVoiceChannelName(prompt);

  if (!guild || !channelName) {
    return null;
  }

  await guild.channels.fetch();

  const normalizedTarget = normalizeName(channelName);
  let bestChannel = null;
  let bestScore = 0;

  guild.channels.cache.forEach((channel) => {
    if (channel.type !== 2) {
      return;
    }

    const score = scoreCandidate(normalizeName(channel.name), normalizedTarget);

    if (score > bestScore) {
      bestChannel = channel;
      bestScore = score;
    }
  });

  return bestChannel;
}

function getGuildVoiceState(guildId) {
  if (!voicePlayers.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause
      }
    });

    player.on("error", (error) => {
      logVoice("player error", {
        guildId,
        error: error?.message || String(error)
      });
    });

    voicePlayers.set(guildId, {
      player,
      ffmpegProcess: null,
      ytDlpProcess: null
    });
  }

  return voicePlayers.get(guildId);
}

function cleanupVoiceProcess(state) {
  if (state?.ffmpegProcess && !state.ffmpegProcess.killed) {
    state.ffmpegProcess.kill("SIGKILL");
  }

  if (state?.ytDlpProcess && !state.ytDlpProcess.killed) {
    state.ytDlpProcess.kill("SIGKILL");
  }

  if (state) {
    state.ffmpegProcess = null;
    state.ytDlpProcess = null;
  }
}

function isYouTubeUrl(url) {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

function getYtDlpSpawnConfig() {
  if (config.ytDlpCommand.trim()) {
    const parts = config.ytDlpCommand.trim().split(/\s+/);
    return {
      command: parts[0],
      argsPrefix: parts.slice(1)
    };
  }

  if (process.platform === "win32") {
    return {
      command: "py",
      argsPrefix: ["-m", "yt_dlp"]
    };
  }

  return {
    command: "yt-dlp",
    argsPrefix: []
  };
}

function createFfmpegResource(input, usePipeInput = false) {
  const ffmpeg = spawn(
    "ffmpeg",
    [
      ...(usePipeInput
        ? []
        : [
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_delay_max",
            "5"
          ]),
      ...(usePipeInput ? [] : ["-i", input]),
      ...(usePipeInput ? ["-i", "pipe:0"] : []),
      "-analyzeduration",
      "0",
      "-loglevel",
      "warning",
      "-vn",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-f",
      "ogg",
      "pipe:1"
    ],
    {
      windowsHide: true,
      stdio: [usePipeInput ? "pipe" : "ignore", "pipe", "pipe"]
    }
  );

  return {
    process: ffmpeg,
    resource: createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.OggOpus
    })
  };
}

function createYouTubePipeline(url) {
  const ytDlpConfig = getYtDlpSpawnConfig();
  const ytDlpProcess = spawn(
    ytDlpConfig.command,
    [
      ...ytDlpConfig.argsPrefix,
      "-f",
      "bestaudio",
      "--no-playlist",
      "-o",
      "-",
      url
    ],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  const ffmpegSource = createFfmpegResource("", true);
  ytDlpProcess.stdout.pipe(ffmpegSource.process.stdin);

  return {
    ytDlpProcess,
    ffmpegProcess: ffmpegSource.process,
    resource: ffmpegSource.resource
  };
}

async function joinMemberVoiceChannel(guild, member, requestedChannel = null) {
  const freshMember = await resolveGuildMember(guild, member);
  const voiceChannel = requestedChannel || getVoiceChannelFromMember(freshMember);

  logVoice("join requested", {
    guildId: guild?.id || null,
    memberId: freshMember?.id || member?.id || null,
    detectedVoiceChannel: voiceChannel?.name || null,
    requestedChannel: requestedChannel?.name || null
  });

  if (!guild || !voiceChannel) {
    logVoice("join aborted: no voice channel found");
    return {
      ok: false,
      message:
        "Aku belum melihat kamu ada di voice channel. Coba join dulu, atau sebut nama channel voice yang mau dimasuki."
    };
  }

  const permissions = voiceChannel.permissionsFor(guild.members.me);

  if (
    !permissions?.has("Connect") ||
    !permissions?.has("Speak") ||
    !permissions?.has("ViewChannel")
  ) {
    logVoice("join aborted: missing permissions", {
      channel: voiceChannel.name
    });
    return {
      ok: false,
      message:
        "Aku belum punya izin `View Channel`, `Connect`, atau `Speak` di voice channel itu."
    };
  }

  const state = getGuildVoiceState(guild.id);
  const existingConnection = getVoiceConnection(guild.id);

  if (
    existingConnection &&
    existingConnection.joinConfig.channelId === voiceChannel.id
  ) {
    logVoice("reusing existing voice connection", {
      channel: voiceChannel.name,
      guildId: guild.id
    });
    state.connection = existingConnection;
    state.channelId = voiceChannel.id;
    existingConnection.subscribe(state.player);

    return {
      ok: true,
      connection: existingConnection,
      channel: voiceChannel
    };
  }

  if (existingConnection) {
    logVoice("destroying stale voice connection before rejoin", {
      previousChannelId: existingConnection.joinConfig.channelId,
      nextChannel: voiceChannel.name
    });
    existingConnection.destroy();
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true
  });

  state.connection = connection;
  state.channelId = voiceChannel.id;
  connection.subscribe(state.player);
  logVoice("voice connection created", {
    channel: voiceChannel.name,
    guildId: guild.id
  });

  connection.on("stateChange", (oldState, newState) => {
    logVoice("connection state change", {
      guildId: guild.id,
      from: oldState.status,
      to: newState.status
    });
  });

  connection.on("error", (error) => {
    logVoice("connection error", {
      guildId: guild.id,
      error: error?.message || String(error)
    });
  });

  connection.on(VoiceConnectionStatus.Disconnected, async (_, newState) => {
    const activeState = voicePlayers.get(guild.id);

    if (activeState?.connection !== connection) {
      return;
    }

    logVoice("voice disconnected", {
      guildId: guild.id,
      reason: newState.reason,
      closeCode: newState.closeCode
    });

    try {
      if (
        newState.reason === VoiceConnectionDisconnectReason.WebSocketClose &&
        newState.closeCode === 4014
      ) {
        logVoice("attempting reconnect after 4014 close");
        await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
        return;
      }

      logVoice("waiting for signalling/connecting recovery");
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
    } catch (error) {
      logVoice("voice disconnect recovery failed, destroying connection");
      connection.destroy();
      activeState.connection = null;
      activeState.channelId = null;
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    logVoice("voice connection ready", {
      channel: voiceChannel.name,
      guildId: guild.id
    });
  } catch (error) {
    logVoice("voice connection failed to become ready", {
      channel: voiceChannel.name,
      guildId: guild.id,
      error: error?.message || String(error)
    });
    connection.destroy();
    state.connection = null;
    state.channelId = null;

    return {
      ok: false,
      message: "Aku gagal masuk ke voice channel itu."
    };
  }

  return {
    ok: true,
    connection,
    channel: voiceChannel
  };
}

function leaveGuildVoiceChannel(guildId) {
  const state = voicePlayers.get(guildId);

  if (state?.player) {
    state.player.stop(true);
  }

  cleanupVoiceProcess(state);

  if (state?.connection) {
    state.connection.destroy();
  }

  voicePlayers.delete(guildId);
}

function stopGuildPlayback(guildId) {
  const state = voicePlayers.get(guildId);

  if (!state?.player) {
    return false;
  }

  state.player.stop(true);
  cleanupVoiceProcess(state);
  return true;
}

async function playInVoiceChannel(guild, member, url) {
  logVoice("play requested", {
    guildId: guild?.id || null,
    memberId: member?.id || null,
    url
  });

  if (!play.yt_validate(url) && !/^https?:\/\//i.test(url)) {
    logVoice("play rejected: invalid url", { url });
    return {
      ok: false,
      message: "Untuk sekarang aku baru bisa play dari URL yang valid ya."
    };
  }

  const state = getGuildVoiceState(guild.id);
  const existingConnection = getVoiceConnection(guild.id);
  let joined = null;

  if (existingConnection) {
    logVoice("play will reuse existing connection", {
      guildId: guild.id,
      channelId: existingConnection.joinConfig.channelId
    });
    state.connection = existingConnection;
    state.channelId = existingConnection.joinConfig.channelId;
    existingConnection.subscribe(state.player);
    joined = {
      ok: true,
      connection: existingConnection
    };
  } else {
    joined = await joinMemberVoiceChannel(guild, member);
  }

  if (!joined.ok) {
    logVoice("play aborted: join failed", {
      guildId: guild?.id || null,
      message: joined.message
    });
    return joined;
  }

  try {
    logVoice("starting stream request", { url });
    let resource = null;

    cleanupVoiceProcess(state);

    if (isYouTubeUrl(url)) {
      const pipeline = createYouTubePipeline(url);
      state.ytDlpProcess = pipeline.ytDlpProcess;
      state.ffmpegProcess = pipeline.ffmpegProcess;
      resource = pipeline.resource;

      pipeline.ytDlpProcess.stderr.on("data", (chunk) => {
        logVoice("yt-dlp stderr", {
          guildId: guild.id,
          message: chunk.toString().trim()
        });
      });

      pipeline.ffmpegProcess.stderr.on("data", (chunk) => {
        logVoice("ffmpeg stderr", {
          guildId: guild.id,
          message: chunk.toString().trim()
        });
      });

      pipeline.ytDlpProcess.on("close", (code) => {
        logVoice("yt-dlp process closed", {
          guildId: guild.id,
          code
        });
      });

      pipeline.ffmpegProcess.on("close", (code) => {
        logVoice("ffmpeg process closed", {
          guildId: guild.id,
          code
        });
      });

      logVoice("stream source selected", {
        url,
        source: "yt-dlp-stdout+ffmpeg"
      });
    } else {
      try {
        const stream = await play.stream(url);
        resource = createAudioResource(stream.stream, {
          inputType: stream.type
        });
        logVoice("stream source selected", { url, source: "play-dl" });
      } catch (primaryError) {
        logVoice("play-dl stream failed, trying ytdl fallback", {
          url,
          error: primaryError?.message || String(primaryError)
        });

        if (!ytdl.validateURL(url)) {
          throw primaryError;
        }

        const fallbackStream = ytdl(url, {
          filter: "audioonly",
          quality: "highestaudio",
          highWaterMark: 1 << 25
        });

        resource = createAudioResource(fallbackStream);
        logVoice("stream source selected", { url, source: "ytdl-core" });
      }
    }

    state.player.on("stateChange", (oldState, newState) => {
      logVoice("player state change", {
        guildId: guild.id,
        from: oldState.status,
        to: newState.status
      });
    });

    state.player.play(resource);
    await entersState(state.player, AudioPlayerStatus.Playing, 15_000);
    logVoice("audio playback started", {
      guildId: guild.id,
      url
    });
  } catch (error) {
    console.error("Failed to play audio:", error);
    logVoice("audio playback failed", {
      guildId: guild?.id || null,
      url,
      error: error?.message || String(error)
    });
    return {
      ok: false,
      message:
        "Aku berhasil masuk voice, tapi gagal memutar audio dari URL itu. Coba URL lain ya."
    };
  }

  return {
    ok: true,
    message: `Siap, aku putar audio dari ${url}`
  };
}

function isJoinVoiceRequest(prompt) {
  return /\b(join|masuk)\b.*\b(vc|voice|voice channel)\b/i.test(prompt);
}

function isLeaveVoiceRequest(prompt) {
  return /\b(leave|keluar|cabut)\b.*\b(vc|voice|voice channel)\b/i.test(prompt);
}

function isStopVoiceRequest(prompt) {
  return /\b(stop|berhenti|pause)\b.*\b(lagu|music|musik|audio|song)?/i.test(
    prompt
  );
}

function extractPlayUrl(prompt) {
  const match = prompt.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
}

function isAmbiguousFollowUp(prompt) {
  return /^(lanjut|lanjutin|yang tadi|tadi itu|ulang|coba lagi|perjelas|jelasin lagi|lebih detail|lebih singkat|lebih santai|ringkasin|singkatin|buat lagi)$/i.test(
    prompt.trim()
  );
}

function needsClarification(prompt) {
  const normalizedPrompt = prompt.trim();

  return (
    isAmbiguousFollowUp(normalizedPrompt) ||
    /^(siapa|who)\??$/i.test(normalizedPrompt) ||
    /^(mention|tag|panggil|suruh)\s*$/i.test(normalizedPrompt)
  );
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

function buildAnswerMessages(history, prompt) {
  const behavioralDirectives = [
    "Pahami intent user, periksa konteks yang tersedia, lalu jawab dengan tenang dan tepat.",
    "Jangan menebak fakta atau maksud user.",
    "Jika konteks kurang jelas, minta klarifikasi singkat.",
    "Untuk pertanyaan lanjutan, utamakan kesinambungan dengan riwayat chat.",
    "Berikan jawaban final saja."
  ];

  if (config.strictFactualMode) {
    behavioralDirectives.push(
      "Jika kamu tidak yakin, katakan secara jujur bahwa kamu belum yakin daripada membuat klaim yang tidak pasti."
    );
  }

  return [
    {
      role: "system",
      content: config.systemPrompt
    },
    {
      role: "system",
      content: behavioralDirectives.join(" ")
    },
    ...history,
    {
      role: "user",
      content: prompt
    }
  ];
}

async function createDraftAnswer(messages) {
  const response = await llm.chat.completions.create({
    model: config.llmModel,
    messages,
    temperature: 0.2
  });

  return response.choices[0]?.message?.content?.trim() || "";
}

async function selfCheckAnswer(history, prompt, draftAnswer) {
  if (!config.selfCheckEnabled || !draftAnswer) {
    return draftAnswer;
  }

  const reviewMessages = [
    {
      role: "system",
      content:
        "Kamu adalah reviewer jawaban untuk bot Discord. Tugasmu mengecek apakah jawaban draft sudah relevan dengan pertanyaan user, konsisten dengan konteks percakapan, tidak keluar topik, dan tidak menebak tanpa dasar. Jika draft kurang tepat, perbaiki. Jika sudah tepat, tulis ulang dengan rapi. Keluarkan jawaban final saja tanpa menjelaskan proses review."
    },
    ...history,
    {
      role: "user",
      content: prompt
    },
    {
      role: "assistant",
      content: draftAnswer
    },
    {
      role: "user",
      content:
        "Periksa ulang jawaban draft di atas. Jika konteks kurang jelas, minta klarifikasi singkat. Jika sudah bagus, kembalikan versi final yang paling relevan."
    }
  ];

  const response = await llm.chat.completions.create({
    model: config.llmModel,
    messages: reviewMessages,
    temperature: 0.1
  });

  return response.choices[0]?.message?.content?.trim() || draftAnswer;
}

async function rewriteDirectedMessage(targetName, instructionText) {
  const trimmedInstruction = instructionText.trim();

  if (!trimmedInstruction) {
    return "";
  }

  const messages = [
    {
      role: "system",
      content:
        "Kamu membantu merapikan instruksi singkat untuk dikirim ke seseorang di Discord. Ubah instruksi user menjadi kalimat langsung yang natural, singkat, jelas, dan tetap mempertahankan maksud aslinya. Jangan menambahkan mention, jangan menyebut nama target, dan jangan mengubah inti perintah. Keluarkan teks final saja."
    },
    {
      role: "user",
      content: `Target: ${targetName}\nInstruksi mentah: ${trimmedInstruction}`
    }
  ];

  const response = await llm.chat.completions.create({
    model: config.llmModel,
    messages,
    temperature: 0.2
  });

  return response.choices[0]?.message?.content?.trim() || trimmedInstruction;
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
    /\b(tag|mention|panggil)\b.*\b(random|orang|member|seseorang)\b/i.test(prompt) ||
    /\b(pick|choose|select|find)\b.*\b(member|person|someone|user)\b/i.test(
      prompt
    ) ||
    /\b(random)\b.*\b(member|person|someone|user)\b/i.test(prompt)
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

function cleanDirectedActionText(text) {
  return text
    .replace(/^(tolong\s+)?(suruh|panggil|tag|mention)\s+/i, "")
    .replace(/^(buat|bilangin|kasih tahu)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRoleTarget(prompt) {
  const match = prompt.match(
    /\b(?:tag|mention|panggil|pick|choose|select|ambil|pilih)\b.*\b(?:role|peran)\b\s+(.+)$/i
  );

  if (!match?.[1]) {
    return null;
  }

  return match[1]
    .replace(/\b(member|anggota|user|orang|someone|person)\b/gi, "")
    .replace(/[?!.,]+$/g, "")
    .trim();
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
  if (!guild) {
    return {
      mention: `@${name}`,
      member: null
    };
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

  return {
    mention: bestMember ? `<@${bestMember.id}>` : `@${name}`,
    member: bestMember
  };
}

async function resolveRole(guild, roleName) {
  if (!guild || !roleName) {
    return null;
  }

  await guild.roles.fetch();

  const normalizedTarget = normalizeName(roleName);
  let bestRole = null;
  let bestScore = 0;

  guild.roles.cache.forEach((role) => {
    if (role.managed || role.id === guild.id) {
      return;
    }

    const score = scoreCandidate(normalizeName(role.name), normalizedTarget);

    if (score > bestScore) {
      bestRole = role;
      bestScore = score;
    }
  });

  return bestRole;
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
    .replace(/\b(pick|choose|select|find)\b/gi, "")
    .replace(/\b(satu|1)\b/gi, "")
    .replace(/\b(member|orang|seseorang|random|siapa\s+pun|person|someone|user)\b/gi, "")
    .replace(/\b(in\s+discord|in\s+server|from\s+server|di\s+discord|di\s+server)\b/gi, "")
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

async function getPriorityAnswer(prompt, guild, channel) {
  if (config.roleAwareMentionMode) {
    const roleTarget = extractRoleTarget(prompt);

    if (roleTarget) {
      const role = await resolveRole(guild, roleTarget);

      if (!role) {
        return `Aku tidak menemukan role bernama "${roleTarget}".`;
      }

      await guild.members.fetch();

      const membersWithRole = guild.members.cache.filter(
        (entry) => !entry.user.bot && entry.roles.cache.has(role.id)
      );

      if (membersWithRole.size === 0) {
        return `Role ${role.name} ada, tapi aku tidak menemukan member aktif yang bisa di-mention dari role itu.`;
      }

      const selectedMember = membersWithRole.random();
      return selectedMember
        ? `<@${selectedMember.id}>`
        : `Aku tidak menemukan member dari role ${role.name}.`;
    }
  }

  if (isRandomWakeRequest(prompt)) {
    const mention = await pickRandomMemberMention(
      channel,
      guild,
      client.user ? [client.user.id] : []
    );

    if (mention) {
      const actionText = extractRandomActionText(prompt);

      return actionText ? `${mention} ${actionText}`.trim() : mention;
    }

    return "Aku tidak menemukan member yang bisa di-tag di sini.";
  }

  const actionRequest = extractActionRequest(prompt);

  if (actionRequest) {
    const resolvedTarget = await resolveSingleMention(guild, actionRequest.target);
    const cleanedPrompt = cleanDirectedActionText(actionRequest.rest);

    if (cleanedPrompt) {
      const targetLabel =
        resolvedTarget.member?.displayName ||
        resolvedTarget.member?.user?.globalName ||
        resolvedTarget.member?.user?.username ||
        actionRequest.target;
      const rewrittenPrompt = await rewriteDirectedMessage(
        targetLabel,
        cleanedPrompt
      );

      return `${resolvedTarget.mention} ${rewrittenPrompt}`.trim();
    }

    return `${resolvedTarget.mention}`;
  }

  if (isBeautyQuestion(prompt)) {
    return "Aku bisa bantu mention member tertentu kalau kamu sebut namanya.";
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

  if (config.replyDelayMs > 0) {
    await sleep(config.replyDelayMs);
  }

  await interaction.editReply(chunks[0]);

  for (const chunk of chunks.slice(1)) {
    await interaction.followUp(chunk);
  }
}

async function handleJoin(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const result = await joinMemberVoiceChannel(
    interaction.guild,
    interaction.member
  );
  await interaction.editReply(
    result.ok
      ? `Aku masuk ke voice channel ${result.channel.name}.`
      : result.message
  );
}

async function handleLeave(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guildId || !getVoiceConnection(interaction.guildId)) {
    await interaction.editReply("Aku sedang tidak ada di voice channel.");
    return;
  }

  leaveGuildVoiceChannel(interaction.guildId);
  await interaction.editReply("Aku keluar dari voice channel.");
}

async function handleStop(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guildId || !stopGuildPlayback(interaction.guildId)) {
    await interaction.editReply("Saat ini tidak ada audio yang sedang diputar.");
    return;
  }

  await interaction.editReply("Audio dihentikan.");
}

async function handlePlay(interaction) {
  await interaction.deferReply();

  const url = interaction.options.getString("url", true);
  const result = await playInVoiceChannel(interaction.guild, interaction.member, url);

  await interaction.editReply(result.message);
}

async function generateAnswer(conversationKey, prompt) {
  const history = conversationState.get(conversationKey) || [];

  if (config.askClarifyFirstMode && history.length === 0 && needsClarification(prompt)) {
    return "Aku belum punya konteks sebelumnya untuk itu. Coba kirim ulang topiknya atau pertanyaan lengkapnya ya.";
  }

  const draftAnswer = await createDraftAnswer(
    buildAnswerMessages(history, prompt)
  );
  const answer =
    (await selfCheckAnswer(history, prompt, draftAnswer)) ||
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
        name: "the server",
        type: ActivityType.Playing
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
      return;
    }

    if (interaction.commandName === "join") {
      await handleJoin(interaction);
      return;
    }

    if (interaction.commandName === "leave") {
      await handleLeave(interaction);
      return;
    }

    if (interaction.commandName === "stop") {
      await handleStop(interaction);
      return;
    }

    if (interaction.commandName === "play") {
      await handlePlay(interaction);
    }
  } catch (error) {
    console.error("Failed to handle interaction:", error);
    const message = getUserFacingErrorMessage(error);

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

    if (isJoinVoiceRequest(prompt)) {
      const requestedChannel = await resolveRequestedVoiceChannel(
        message.guild,
        prompt
      );
      const result = await joinMemberVoiceChannel(
        message.guild,
        message.member,
        requestedChannel
      );
      await message.reply(
        result.ok
          ? `Aku masuk ke voice channel ${result.channel.name}.`
          : result.message
      );
      return;
    }

    if (isLeaveVoiceRequest(prompt)) {
      if (!message.guildId || !getVoiceConnection(message.guildId)) {
        await message.reply("Aku sedang tidak ada di voice channel.");
        return;
      }

      leaveGuildVoiceChannel(message.guildId);
      await message.reply("Aku keluar dari voice channel.");
      return;
    }

    if (isStopVoiceRequest(prompt)) {
      if (!message.guildId || !stopGuildPlayback(message.guildId)) {
        await message.reply("Saat ini tidak ada audio yang sedang diputar.");
        return;
      }

      await message.reply("Audio dihentikan.");
      return;
    }

    const playUrl = extractPlayUrl(prompt);

    if (playUrl && /\b(play|putar)\b/i.test(prompt)) {
      const result = await playInVoiceChannel(message.guild, message.member, playUrl);
      await message.reply(result.message);
      return;
    }

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

    if (config.replyDelayMs > 0) {
      await sleep(config.replyDelayMs);
    }

    await message.reply(chunks[0]);

    for (const chunk of chunks.slice(1)) {
      await message.channel.send(chunk);
    }
  } catch (error) {
    console.error("Failed to handle mention message:", error);
    await message.reply(getUserFacingErrorMessage(error));
  }
});

client.login(config.discordToken);
