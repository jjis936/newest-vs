// bot.js
// Everything the bot does at runtime lives here: client setup, routing
// interactions to the right handler in commands.js, and the giveaway
// end-check loop. Slash command *registration* with Discord happens in
// deploy-commands.js (run automatically on boot, see package.json).

require("dotenv").config();

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const {
    CONFIG,
    slashCommands,
    buttonHandlers,
    selectHandlers,
    modalHandlers,
    giveawaysDB,
    handleLeaveVouchMessage,
    handleNewMember,
    handleAiSupportMessage,
    handleSecurityChecks,
    handleAuditLogEntry
} = require("./commands");

const { initMusic } = require("./music-manager");
const { musicCommands } = require("./music-commands");
const { musicButtonHandlers, musicModalHandlers } = require("./music-buttons");
const { handleVoiceStateUpdate } = require("./music-voiceCleanup");

// ---------------------------------------------------------------------------
// CRITICAL SAFETY NET - without this, ANY uncaught error anywhere in the
// process (a bad setTimeout callback, an unhandled promise rejection, a
// third-party library quirk) takes the ENTIRE bot offline instantly. This is
// exactly what happened with the ticket-close bug - log it and keep running
// instead of dying.
// ---------------------------------------------------------------------------
process.on("uncaughtException", (error) => {
    console.error("🛑 [uncaughtException] The bot almost crashed but this handler caught it:", error);
});
process.on("unhandledRejection", (reason) => {
    console.error("🛑 [unhandledRejection] The bot almost crashed but this handler caught it:", reason);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates // REQUIRED for music: without this, Discord never sends
                                           // voice session/state data to the bot, so Shoukaku can
                                           // never actually establish a Lavalink voice connection.
                                           // This is NOT a privileged intent - no dev portal toggle needed.
    ]
});

// Build a quick lookup map: commandName -> execute() - merges the regular
// commands with the music commands into one map
const allCommands = [...slashCommands, ...musicCommands];
const commandMap = new Map(allCommands.map(c => [c.data.name, c.execute]));
const autocompleteMap = new Map(allCommands.filter(c => c.autocomplete).map(c => [c.data.name, c.autocomplete]));

// Music commands/buttons expect a small context object (brand name/color for
// embeds) as a second argument - regular commands just ignore the extra arg
const ctx = { brandName: CONFIG.BRAND_NAME, brandColor: CONFIG.COLOR };

// Merge in the music buttons alongside the regular ones
const allButtonHandlers = { ...buttonHandlers, ...musicButtonHandlers };
const allModalHandlers = { ...modalHandlers, ...musicModalHandlers };

client.once("clientReady", () => {
    console.log(`💎 ${client.user.tag} is online`);
    client.user.setActivity(`${CONFIG.BRAND_NAME} | Orders`);

    console.log("--- Config check ---");
    console.log("VOUCH_CHANNEL_ID:", CONFIG.VOUCH_CHANNEL_ID || "❌ NOT SET");
    console.log("LEAVE_VOUCH_CHANNEL_ID:", CONFIG.LEAVE_VOUCH_CHANNEL_ID || "❌ NOT SET");
    console.log("WEBSITE_URL:", CONFIG.WEBSITE_URL || "❌ NOT SET");
    console.log("--------------------");
});

client.on("interactionCreate", async (interaction) => {

    const label = interaction.isChatInputCommand() || interaction.isAutocomplete() ? `/${interaction.commandName}`
        : interaction.customId ? `[${interaction.customId}]`
        : "[unknown interaction]";

    console.log(`[interaction] ${label} from ${interaction.user.tag}`);

    try{

        if(interaction.isAutocomplete()){
            const autocomplete = autocompleteMap.get(interaction.commandName);
            if(autocomplete) await autocomplete(interaction);
            return;
        }

        if(interaction.isChatInputCommand()){
            const execute = commandMap.get(interaction.commandName);
            if(execute){
                await execute(interaction, ctx);
                console.log(`[interaction] ${label} completed OK`);
            }else{
                console.log(`[interaction] ❌ no handler registered for ${label}`);
            }
            return;
        }

        if(interaction.isButton()){
            // Exact match first (covers almost every button in the bot)
            let handler = allButtonHandlers[interaction.customId];

            // Fallback: dynamic IDs like "app_accept_APP-0001" route to the
            // generic "app_accept" handler, which parses the app ID itself
            if(!handler){
                if(interaction.customId.startsWith("app_accept_")) handler = allButtonHandlers.app_accept;
                else if(interaction.customId.startsWith("app_deny_")) handler = allButtonHandlers.app_deny;
            }

            if(handler){
                await handler(interaction, ctx);
                console.log(`[interaction] ${label} completed OK`);
            }else{
                await interaction.reply({ content: "❌ Button not configured.", ephemeral: true }).catch(() => {});
            }
            return;
        }

        if(interaction.isStringSelectMenu()){
            const handler = selectHandlers[interaction.customId];
            if(handler){
                await handler(interaction);
                console.log(`[interaction] ${label} completed OK`);
            }
            return;
        }

        if(interaction.isModalSubmit()){
            const handler = allModalHandlers[interaction.customId];
            if(handler){
                await handler(interaction);
                console.log(`[interaction] ${label} completed OK`);
            }
            return;
        }

    }catch(error){

        console.error(`[interaction] ❌ ${label} threw:`, error);

        // Show the *real* error instead of a useless generic message, so you
        // don't have to dig through Railway logs every single time.
        const detail = `\`${error.code ? error.code + ": " : ""}${error.message}\``;

        try{
            if(!interaction.replied && !interaction.deferred){
                await interaction.reply({ content: `❌ Something went wrong: ${detail}`, ephemeral: true });
            }else{
                await interaction.followUp({ content: `❌ Something went wrong: ${detail}`, ephemeral: true });
            }
        }catch(replyErr){
            console.error(`[interaction] ❌ ${label} - even the fallback error reply failed:`, replyErr.message);
        }

    }

});

// ---------------------------------------------------------------------------
// GIVEAWAY END-CHECK LOOP
// ---------------------------------------------------------------------------

client.on("guildMemberAdd", async (member) => {
    try{
        await handleNewMember(member);
    }catch(error){
        console.error("Welcome/autorole handler error:", error);
    }
});

// MUSIC: catches the bot being manually disconnected/kicked from voice
// (or left alone in a channel) and cleans up that guild's queue so the
// next /play actually reconnects instead of silently doing nothing.
client.on("voiceStateUpdate", async (oldState, newState) => {
    try{
        await handleVoiceStateUpdate(oldState, newState, client);
    }catch(error){
        console.error("🎵 ❌ voiceStateUpdate cleanup error:", error);
    }
});

client.on("guildAuditLogEntryCreate", async (entry, guild) => {
    try{
        await handleAuditLogEntry(entry, guild);
    }catch(error){
        console.error("Anti-nuke handler error:", error);
    }
});

client.on("messageCreate", async (message) => {
    try{
        const handled = await handleSecurityChecks(message);
        if(handled) return; // message was deleted as a security violation, stop here

        await handleLeaveVouchMessage(message);
        await handleAiSupportMessage(message);
    }catch(error){
        console.error("Leave-vouch handler error:", error);
    }
});

setInterval(async () => {

    const giveaways = giveawaysDB.read();
    let changed = false;

    for(const [messageId, g] of Object.entries(giveaways)){

        if(g.ended || Date.now() < g.endTime) continue;

        g.ended = true;
        changed = true;

        try{

            const channel = await client.channels.fetch(g.channelId).catch(() => null);
            if(!channel) continue;

            const winner = g.entries.length
                ? g.entries[Math.floor(Math.random() * g.entries.length)]
                : null;

            const embed = new EmbedBuilder()
                .setColor("#b026ff")
                .setTitle("🎉 GIVEAWAY ENDED")
                .setDescription(
                    `🎁 **Prize**\n${g.prize}\n\n` +
                    `🏆 **Winner**\n${winner ? `<@${winner}>` : "No valid entries"}\n\n` +
                    `👥 **Entries**\n${g.entries.length}`
                )
                .setTimestamp();

            await channel.send({
                content: winner ? `🎊 Congratulations <@${winner}>! You won **${g.prize}**!` : "⚠️ Giveaway ended, no one entered.",
                embeds: [embed]
            });

        }catch(err){
            console.log(`[giveaway] ❌ could not announce winner for ${messageId}: ${err.message}`);
        }

    }

    if(changed) giveawaysDB.write(giveaways);

}, 10000);

// CRITICAL: Shoukaku must be initialized BEFORE client.login() is called,
// or it will never properly hook into the gateway and Lavalink will never
// connect. This was the actual missing piece before.
initMusic(client);

client.login(process.env.TOKEN);
