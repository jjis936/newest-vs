/* ============================================================
   TICKET ENDPOINT — paste this into your existing bot's main file
   (the same file where you create your Discord `client`).
   Works with discord.js v14. If you're on v13, see the note below.
   ============================================================ */

// --- 1. Install these two packages in your Railway project ---
//     npm install express cors
//     (then commit + push so Railway redeploys with them)

const express = require('express');
const cors = require('cors');
const { EmbedBuilder } = require('discord.js'); // already available if you're on discord.js v14

// --- 2. Channel ID for your ticket channel ---
//     Already filled in below. If you ever move channels, either edit this
//     directly or set a Railway variable named TICKET_CHANNEL_ID to override it.
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID || '1528360420635574292';

// --- 3. Add this AFTER you create `client` and call client.login(...) ---
// (so `client` below refers to your existing bot client variable —
//  rename it if your variable is called something else, e.g. `bot`)

const app = express();
app.use(cors());
app.use(express.json());

app.post('/ticket', async (req, res) => {
  try {
    const { discordName, subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ error: 'Missing subject or message' });
    }
    if (!TICKET_CHANNEL_ID) {
      console.error('TICKET_CHANNEL_ID is not set in Railway variables.');
      return res.status(500).json({ error: 'Server misconfigured: no ticket channel set' });
    }

    const channel = await client.channels.fetch(TICKET_CHANNEL_ID);
    if (!channel) {
      return res.status(500).json({ error: 'Ticket channel not found — check TICKET_CHANNEL_ID' });
    }

    const embed = new EmbedBuilder()
      .setTitle('🎫 New Support Ticket')
      .setColor(0x3FE0E0)
      .addFields(
        { name: 'Discord Username', value: discordName || 'Not provided', inline: true },
        { name: 'Subject', value: subject, inline: false },
        { name: 'Message', value: message, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'Weekendthriller Services — Support Center' });

    await channel.send({ embeds: [embed] });

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to send ticket:', err);
    res.status(500).json({ error: 'Failed to send ticket' });
  }
});

// Railway gives you a PORT automatically — don't hardcode 3000 in production
app.listen(process.env.PORT || 3000, () => {
  console.log('Ticket API listening on port', process.env.PORT || 3000);
});

/* ============================================================
   discord.js v13 note: replace
     const { EmbedBuilder } = require('discord.js');
     new EmbedBuilder()
   with
     const { MessageEmbed } = require('discord.js');
     new MessageEmbed()
   the rest of the API is identical.
   ============================================================ */
