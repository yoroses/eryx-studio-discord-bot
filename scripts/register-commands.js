import { REST, Routes } from "discord.js";
import { commands } from "../src/commands.js";
import { config } from "../src/config.js";

const rest = new REST({ version: "10" }).setToken(config.discordToken);

try {
  console.log("Registering slash commands...");

  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(
        config.discordClientId,
        config.discordGuildId
      )
    : Routes.applicationCommands(config.discordClientId);

  await rest.put(route, { body: commands });

  console.log("Slash commands registered successfully.");
} catch (error) {
  console.error("Failed to register slash commands:", error);
  process.exitCode = 1;
}
