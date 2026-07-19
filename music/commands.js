// music/commands.js
// Music slash commands for Lavalink/Shoukaku system.

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");

const { queueManager } = require("./queueManager");
const { resolve } = require("./resolver");
const { buildNowPlayingEmbed, buildQueueEmbed } = require("./embeds");
const { buildControlRows } = require("./buttons");
const {
    playNext,
    playPrevious,
    destroyQueue,
    sendOrUpdateNowPlaying,
    registerPlayerEvents
} = require("./player");

const {
    inSameVoice,
    cycleLoop,
    loopLabel
} = require("./util");


const MUSIC_COLOR = "#B30000";


// /play autocomplete
async function musicAutocomplete(interaction) {

    const focused = interaction.options.getFocused();

    if (!focused || focused.trim().length < 2) {
        return interaction.respond([]);
    }

    try {

        const res = await fetch(
            `https://api.deezer.com/search?q=${encodeURIComponent(focused)}&limit=20`
        );

        const data = await res.json();

        const choices = (data.data || [])
            .slice(0, 25)
            .map(track => {

                const name =
                    `${track.title} — ${track.artist.name}`
                    .slice(0, 100);

                const value =
                    `${track.artist.name} ${track.title}`
                    .slice(0, 100);

                return {
                    name,
                    value
                };
            });


        await interaction.respond(choices);


    } catch (err) {

        console.log(
            `[music] ⚠️ autocomplete failed: ${err.message}`
        );

        await interaction.respond([]).catch(() => {});
    }
}



const musicSlashCommands = [

    // ==========================
    // /play
    // ==========================

    {
        data: new SlashCommandBuilder()
            .setName("play")
            .setDescription(
                "Play a song from YouTube, Spotify, Apple Music, SoundCloud, Deezer, or Bandcamp"
            )
            .addStringOption(option =>
                option
                    .setName("query")
                    .setDescription("Song name, artist, or link")
                    .setRequired(true)
                    .setAutocomplete(true)
            ),


        async execute(interaction) {

            const voiceChannel =
                interaction.member.voice?.channel;


            if (!voiceChannel) {

                return interaction.reply({
                    content: "❌ Join a voice channel first.",
                    ephemeral: true
                });

            }


            const permissions =
                voiceChannel.permissionsFor(
                    interaction.guild.members.me
                );


            if (
                !permissions?.has(PermissionFlagsBits.Connect) ||
                !permissions?.has(PermissionFlagsBits.Speak)
            ) {

                return interaction.reply({
                    content:
                        "❌ I need Connect and Speak permissions in your voice channel.",
                    ephemeral: true
                });

            }


            await interaction.deferReply();


            const shoukaku =
                interaction.client.shoukaku;


            const node =
                shoukaku?.getIdealNode();


            if (!node) {

                return interaction.editReply(
                    "❌ No Lavalink node connected. Check your Lavalink settings."
                );

            }



            let queue =
                queueManager.get(interaction.guildId);



            if (!queue || !queue.shoukakuPlayer) {


                let player;


                try {

                    player =
                        await shoukaku.joinVoiceChannel({

                            guildId: interaction.guildId,

                            channelId: voiceChannel.id,

                            shardId:
                                interaction.guild.shardId ?? 0,

                            deaf: true

                        });


                } catch (err) {


                    console.error(
                        `[music] ❌ Voice join failed: ${err.message}`
                    );


                    return interaction.editReply(
                        `❌ Couldn't join voice channel: ${err.message}`
                    );

                }



                queue =
                    queueManager.create({

                        guildId:
                            interaction.guildId,

                        voiceChannelId:
                            voiceChannel.id,

                        textChannel:
                            interaction.channel,

                        shoukaku,

                        shoukakuPlayer:
                            player

                    });



                registerPlayerEvents(queue);

            }



            const query =
                interaction.options.getString(
                    "query",
                    true
                );



            let result;


            try {

                result =
                    await resolve(
                        queue.shoukakuPlayer.node,
                        query,
                        {
                            id: interaction.user.id,
                            tag: interaction.user.tag
                        }
                    );


            } catch (err) {


                console.error(
                    `[music] Resolve error: ${err.message}`
                );


                return interaction.editReply(
                    `❌ ${err.message}`
                );

            }



            if (!result.tracks.length) {

                return interaction.editReply(
                    "❌ No playable results found."
                );

            }



            queue.tracks.push(
                ...result.tracks
            );


            const wasIdle =
                !queue.current;



            if (wasIdle) {

                await playNext(
                    queue,
                    {
                        respectTrackLoop:false
                    }
                );

            }



            const embed =
                new EmbedBuilder()
                    .setColor(MUSIC_COLOR)
                    .setDescription(

                        result.tracks.length === 1

                        ? `✅ Added **${result.tracks[0].title}** to the queue.`

                        : `✅ Added **${result.tracks.length} tracks** to the queue.`

                    );



            await interaction.editReply({
                embeds:[embed]
            });

        }
    },
        // ==========================
    // /pause
    // ==========================

    {
        data: new SlashCommandBuilder()
            .setName("pause")
            .setDescription("Pause the current song"),

        async execute(interaction) {

            const queue =
                queueManager.get(interaction.guildId);


            if (!queue || !queue.current) {

                return interaction.reply({
                    content: "❌ Nothing is playing.",
                    ephemeral:true
                });

            }


            if (!inSameVoice(interaction, queue)) {

                return interaction.reply({
                    content:"❌ You need to be in the same voice channel.",
                    ephemeral:true
                });

            }


            await queue.shoukakuPlayer.setPaused(true);

            await sendOrUpdateNowPlaying(queue);


            await interaction.reply({
                content:"⏸️ Paused.",
                ephemeral:true
            });

        }
    },


    // ==========================
    // /resume
    // ==========================

    {
        data:new SlashCommandBuilder()
            .setName("resume")
            .setDescription("Resume the current song"),

        async execute(interaction){

            const queue =
                queueManager.get(interaction.guildId);


            if(!queue || !queue.current){

                return interaction.reply({
                    content:"❌ Nothing is playing.",
                    ephemeral:true
                });

            }


            await queue.shoukakuPlayer.setPaused(false);

            await sendOrUpdateNowPlaying(queue);


            await interaction.reply({
                content:"▶️ Resumed.",
                ephemeral:true
            });

        }
    },


    // ==========================
    // /skip
    // ==========================

    {
        data:new SlashCommandBuilder()
            .setName("skip")
            .setDescription("Skip the current song"),

        async execute(interaction){

            const queue =
                queueManager.get(interaction.guildId);


            if(!queue || !queue.current){

                return interaction.reply({
                    content:"❌ Nothing is playing.",
                    ephemeral:true
                });

            }


            const skipped =
                queue.current;


            await playNext(queue,{
                respectTrackLoop:false
            });


            await interaction.reply({

                content:
                    `⏭️ Skipped **${skipped.title}**.`,

                ephemeral:true
            });

        }
    },


    // ==========================
    // /previous
    // ==========================

    {
        data:new SlashCommandBuilder()
            .setName("previous")
            .setDescription("Play the previous song"),

        async execute(interaction){

            const queue =
                queueManager.get(interaction.guildId);


            if(!queue){

                return interaction.reply({
                    content:"❌ Nothing is playing.",
                    ephemeral:true
                });

            }


            const success =
                await playPrevious(queue);


            await interaction.reply({

                content:
                    success
                    ? "⏮️ Playing previous track."
                    : "❌ No previous track.",

                ephemeral:true
            });

        }
    },


    // ==========================
    // /stop
    // ==========================

    {
        data:new SlashCommandBuilder()
            .setName("stop")
            .setDescription("Stop music and disconnect"),

        async execute(interaction){

            const queue =
                queueManager.get(interaction.guildId);


            if(!queue){

                return interaction.reply({
                    content:"❌ Nothing playing.",
                    ephemeral:true
                });

            }


            queue.tracks=[];


            await destroyQueue(
                queue,
                `Stopped by ${interaction.user.tag}.`
            );


            await interaction.reply({
                content:"⏹️ Stopped and disconnected.",
                ephemeral:true
            });

        }
    },


    // ==========================
    // /queue
    // ==========================

    {
        data:new SlashCommandBuilder()
            .setName("queue")
            .setDescription("Show music queue")
            .addIntegerOption(option =>
                option
                .setName("page")
                .setDescription("Queue page")
                .setMinValue(1)
            ),

        async execute(interaction){

            const queue =
                queueManager.get(interaction.guildId);


            if(!queue){

                return interaction.reply({
                    content:"❌ Queue empty.",
                    ephemeral:true
                });

            }


            const page =
                interaction.options.getInteger("page") || 1;


            await interaction.reply({

                embeds:[
                    buildQueueEmbed(queue,page)
                ]

            });

        }
    },


    // ==========================
    // /shuffle
    // ==========================

    {
        data:new SlashCommandBuilder()
            .setName("shuffle")
            .setDescription("Shuffle queue"),

        async execute(interaction){

            const queue =
                queueManager.get(interaction.guildId);


            if(!queue || queue.tracks.length < 2){

                return interaction.reply({
                    content:"❌ Not enough songs.",
                    ephemeral:true
                });

            }


            queue.tracks.sort(
                () => Math.random() - .5
            );


            await sendOrUpdateNowPlaying(queue);


            await interaction.reply({
                content:"🔀 Queue shuffled.",
                ephemeral:true
            });

        }
    },


    // ==========================
    // /loop
    // ==========================

    {
        data:new SlashCommandBuilder()
            .setName("loop")
            .setDescription("Change loop mode")
            .addStringOption(option =>
                option
                .setName("mode")
                .setDescription("Loop type")
                .addChoices(
                    {
                        name:"Off",
                        value:"off"
                    },
                    {
                        name:"Current Song",
                        value:"track"
                    },
                    {
                        name:"Queue",
                        value:"queue"
                    }
                )
            ),

        async execute(interaction){

            const queue =
                queueManager.get(interaction.guildId);


            if(!queue){

                return interaction.reply({
                    content:"❌ Nothing playing.",
                    ephemeral:true
                });

            }


            queue.loop =
                interaction.options.getString("mode")
                ||
                cycleLoop(queue.loop);


            await sendOrUpdateNowPlaying(queue);


            await interaction.reply({

                content:
                    `🔁 Loop mode: **${loopLabel(queue.loop)}**`,

                ephemeral:true

            });

        }
    },


    // ==========================
    // /volume
    // ==========================

    {
        data:new SlashCommandBuilder()
            .setName("volume")
            .setDescription("Set volume")
            .addIntegerOption(option =>
                option
                .setName("percent")
                .setDescription("0-200")
                .setMinValue(0)
                .setMaxValue(200)
            ),

        async execute(interaction){

            const queue =
                queueManager.get(interaction.guildId);


            if(!queue){

                return interaction.reply({
                    content:"❌ Nothing playing.",
                    ephemeral:true
                });

            }


            const volume =
                interaction.options.getInteger("percent");


            if(volume === null){

                return interaction.reply({

                    content:
                        `🔊 Volume: **${queue.volume}%**`,

                    ephemeral:true

                });

            }


            queue.volume =
                volume;


            await queue.shoukakuPlayer
                .setGlobalVolume(volume);


            await sendOrUpdateNowPlaying(queue);


            await interaction.reply({

                content:
                    `🔊 Volume set to **${volume}%**.`,

                ephemeral:true

            });

        }
    },


    // ==========================
    // /nowplaying
    // ==========================

    {
        data:new SlashCommandBuilder()
            .setName("nowplaying")
            .setDescription("Show current song"),

        async execute(interaction){

            const queue =
                queueManager.get(interaction.guildId);


            if(!queue || !queue.current){

                return interaction.reply({
                    content:"❌ Nothing playing.",
                    ephemeral:true
                });

            }


            await interaction.reply({

                embeds:[
                    buildNowPlayingEmbed(queue)
                ],

                components:
                    buildControlRows(queue)

            });

        }
    }

];



module.exports = {
    musicSlashCommands,
    musicAutocomplete
};
