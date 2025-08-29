// index.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

// test.json のパス
const DATA_PATH = path.join(__dirname, "test.json");

// 設定を読み込む（なければ作成）
function loadConfig() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
}

// 設定を保存
function saveConfig(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// Discordクライアント作成
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// スラッシュコマンド登録
const commands = [
  new SlashCommandBuilder()
    .setName("setch")
    .setDescription("自己紹介が書かれている転送元チャンネルを設定")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("自己紹介が書かれているチャンネル")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("settoch")
    .setDescription("自己紹介を転送する転送先チャンネルを設定")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("転送先のチャンネル")
        .setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

// botログイン時
const guildIds = process.env.GUILD_IDS.split(",");

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  // 複数ギルドに登録
  for (const guildId of guildIds) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId.trim()),
        { body: commands }
      );
      console.log(`✅ Slash commands registered in guild ${guildId}`);
    } catch (err) {
      console.error(`❌ Failed to register in guild ${guildId}`, err);
    }
  }
});

// コマンド処理
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  const config = loadConfig();

  // そのギルド用の設定を確保
  if (!config[guildId]) config[guildId] = {};

  if (interaction.commandName === "setch") {
    const channel = interaction.options.getChannel("channel");
    config[guildId].sourceChannel = channel.id;
    saveConfig(config);
    await interaction.reply(
      `✅ このサーバーの転送元チャンネルを <#${channel.id}> に設定しました`
    );
  }

  if (interaction.commandName === "settoch") {
    const channel = interaction.options.getChannel("channel");
    config[guildId].targetChannel = channel.id;
    saveConfig(config);
    await interaction.reply(
      `✅ このサーバーの転送先チャンネルを <#${channel.id}> に設定しました`
    );
  }
});

// VC参加・退出を検知
client.on("voiceStateUpdate", async (oldState, newState) => {
  const guildId = newState.guild.id;
  const config = loadConfig();
  const guildConfig = config[guildId];
  if (!guildConfig || !guildConfig.sourceChannel || !guildConfig.targetChannel)
    return;

  // VCに入ったユーザーを判定（参加時）
  if (!oldState.channelId && newState.channelId) {
    const member = newState.member;
    if (!member) return;

    const sourceCh = await client.channels
      .fetch(guildConfig.sourceChannel)
      .catch(() => null);
    const targetCh = await client.channels
      .fetch(guildConfig.targetChannel)
      .catch(() => null);
    if (!sourceCh || !targetCh) return;

    const messages = await sourceCh.messages.fetch({ limit: 100 });
    const introMsg = messages.find((msg) => msg.author.id === member.id);

    if (introMsg) {
      const sentMsg = await targetCh.send({
        content: `📌 <@${member.id}> の自己紹介\n\n${introMsg.content}`,
      });

      // 転送したメッセージIDを保存
      if (!guildConfig.introMessages) guildConfig.introMessages = {};
      guildConfig.introMessages[member.id] = sentMsg.id;
      saveConfig(config);
    }
  }

  // VC退出を判定
  if (oldState.channelId && !newState.channelId) {
    const member = oldState.member;
    if (!member) return;

    if (!guildConfig.introMessages) return;
    const messageId = guildConfig.introMessages[member.id];
    if (!messageId) return;

    const targetCh = await client.channels
      .fetch(guildConfig.targetChannel)
      .catch(() => null);
    if (!targetCh) return;

    // 保存してある転送メッセージを削除
    const sentMsg = await targetCh.messages.fetch(messageId).catch(() => null);
    if (sentMsg) {
      await sentMsg.delete().catch(() => {});
    }

    // JSONからも削除
    delete guildConfig.introMessages[member.id];
    saveConfig(config);
  }
});

// Bot起動
client.login(process.env.TOKEN);
