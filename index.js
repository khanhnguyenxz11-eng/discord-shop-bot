const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  REST,
  Routes
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const fetch = require("node-fetch");
const { v4: uuidv4 } = require("uuid");

const {
  BOT_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  ADMIN_ROLE_ID,
  SEPAY_API_KEY,
  WEBHOOK_SECRET,
  PORT
} = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

let db = JSON.parse(fs.readFileSync("./database.json"));

function saveDB() {
  fs.writeFileSync("./database.json", JSON.stringify(db, null, 2));
}

function createEmbed() {
  return {
    color: 0x00bfff,
    title: "BUY KEY TỰ ĐỘNG 💳",
    description:
      `🔑 KEY THÁNG : ${db.keys.month.length}\n` +
      `🔑 KEY TUẦN  : ${db.keys.week.length}\n` +
      `🔑 KEY NGÀY  : ${db.keys.day.length}\n\n` +
      "Nhấn nút bên dưới để mua"
  };
}

function createButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("buy_day").setLabel("Key Ngày").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("buy_week").setLabel("Key Tuần").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("buy_month").setLabel("Key Tháng").setStyle(ButtonStyle.Danger)
  );
}

async function updatePanel() {
  if (!db.panelMessageId) return;
  const channel = await client.channels.fetch(db.panelChannelId);
  const message = await channel.messages.fetch(db.panelMessageId);
  await message.edit({ embeds: [createEmbed()], components: [createButtons()] });
}

async function deployCommands() {
  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    {
      body: [
        {
          name: "setup",
          description: "Tạo panel shop"
        },
        {
          name: "addkey",
          description: "Thêm key",
          options: [
            {
              name: "type",
              type: 3,
              required: true,
              choices: [
                { name: "day", value: "day" },
                { name: "week", value: "week" },
                { name: "month", value: "month" }
              ]
            },
            {
              name: "key",
              type: 3,
              required: true
            }
          ]
        }
      ]
    }
  );
}

client.once("ready", async () => {
  console.log("Bot online");
  await deployCommands();
});

client.on(Events.InteractionCreate, async interaction => {

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "setup") {

      if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID))
        return interaction.reply({ content: "Không có quyền", ephemeral: true });

      const msg = await interaction.reply({
        embeds: [createEmbed()],
        components: [createButtons()],
        fetchReply: true
      });

      db.panelMessageId = msg.id;
      db.panelChannelId = msg.channel.id;
      saveDB();
    }

    if (interaction.commandName === "addkey") {

      if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID))
        return interaction.reply({ content: "Không có quyền", ephemeral: true });

      const type = interaction.options.getString("type");
      const key = interaction.options.getString("key");

      db.keys[type].push(key);
      saveDB();
      await updatePanel();

      interaction.reply("Đã thêm key.");
    }
  }

  if (interaction.isButton()) {

    const type = interaction.customId.split("_")[1];

    const modal = new ModalBuilder()
      .setCustomId(`modal_${type}`)
      .setTitle("Nhập số lượng");

    const input = new TextInputBuilder()
      .setCustomId("quantity")
      .setLabel("Số lượng")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit()) {

    const type = interaction.customId.split("_")[1];
    const quantity = parseInt(interaction.fields.getTextInputValue("quantity"));

    if (isNaN(quantity) || quantity <= 0)
      return interaction.reply({ content: "Số lượng không hợp lệ", ephemeral: true });

    if (db.keys[type].length < quantity)
      return interaction.reply({ content: "Không đủ key", ephemeral: true });

    const prices = { day: 10000, week: 50000, month: 150000 };
    const total = prices[type] * quantity;
    const orderId = uuidv4();

    db.orders.push({ orderId, userId: interaction.user.id, type, quantity, total, status: "pending" });
    saveDB();

    interaction.reply({
      content: `Đơn: ${orderId}\nSố tiền: ${total}đ\nChuyển khoản với nội dung: ${orderId}`
    });
  }
});

/* ====== WEBHOOK SEPAY ====== */

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {

  if (req.headers["x-secret"] !== WEBHOOK_SECRET)
    return res.sendStatus(403);

  const { content, transferAmount, status } = req.body;
  if (status !== "SUCCESS") return res.sendStatus(200);

  const order = db.orders.find(o =>
    o.orderId === content &&
    o.total == transferAmount &&
    o.status === "pending"
  );

  if (!order) return res.sendStatus(404);

  const delivered = db.keys[order.type].splice(0, order.quantity);
  order.status = "paid";
  saveDB();

  await updatePanel();

  const user = await client.users.fetch(order.userId);
  await user.send(`Thanh toán thành công!\nKey của bạn:\n${delivered.join("\n")}`);

  res.sendStatus(200);
});

app.listen(PORT || 3000, () => console.log("Server running"));

client.login(BOT_TOKEN);
