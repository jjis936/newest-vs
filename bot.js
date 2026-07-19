# Discord
TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
GUILD_ID=your_server_id_here
# ^ leave GUILD_ID blank/remove it to deploy commands globally instead
#   of to one server. Useful if guild-specific deploys keep failing.

VOUCH_CHANNEL_ID=1507682259678003371
LEAVE_VOUCH_CHANNEL_ID=1524746787636772964
BRAND_NAME=Weekendthriller Services
BRAND_ICON_URL=
# ^ optional - paste a direct image URL (like your server icon) to show it
#   as a thumbnail/footer icon on every embed the bot posts

WEBSITE_URL=https://sinner-boost-pro.base44.app
# ^ shown as a "Visit Our Website" link button on the vouch, ticket, and
#   number-rental panels

WELCOME_CHANNEL_ID=
# ^ optional - posts a welcome embed here when someone joins

AUTOROLE_ID=
# ^ optional - role ID to auto-assign to new members

TRANSCRIPT_CHANNEL_ID=
# ^ optional - ticket transcripts get posted here right before the ticket
#   channel is deleted. Strongly recommended - otherwise transcripts are
#   generated but not saved anywhere.

GEMINI_API_KEY=
# ^ required for the 24/7 AI support system (/ask, /support, and the
#   AI_SUPPORT_CHANNEL_ID live-chat channel). FREE - get one at
#   aistudio.google.com/apikey - no credit card needed, generous free
#   daily/per-minute limits are plenty for a support bot.

AI_SUPPORT_CHANNEL_ID=
# ^ optional - if set, EVERY message posted in this channel gets an
#   automatic AI reply, like a live-chat widget. Leave blank to only use
#   the AI through /ask and /support instead.

AI_NAME=Weekendthrillers AI

# SMS number rental providers
FIVESIM_API_KEY=your_5sim_api_key
SMSPOOL_API_KEY=your_smspool_api_key
