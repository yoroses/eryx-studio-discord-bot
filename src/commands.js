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
    .setDescription("Reset riwayat chat AI di channel ini.")
].map((command) => command.toJSON());
