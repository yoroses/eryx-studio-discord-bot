import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Ngobrol dengan AI seperti ChatGPT.")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("Pertanyaan atau pesan yang ingin kamu kirim.")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Reset riwayat chat AI di channel ini."),
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Masuk ke voice channel kamu."),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Keluar dari voice channel saat ini."),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Berhenti memutar audio."),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Putar audio dari URL di voice channel kamu.")
    .addStringOption((option) =>
      option
        .setName("url")
        .setDescription("URL audio atau video yang ingin diputar.")
        .setRequired(true)
    )
].map((command) => command.toJSON());
