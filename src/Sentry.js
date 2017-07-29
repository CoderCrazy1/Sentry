const path = require('path');

const Discord = require('discord.js-commando');
const Datastore = require('nedb-promises');

const {time, sleep} = require('./Util');
const AutoModerator = require('./AutoModerator.js');
const Person = require('./Person.js');

module.exports = 
class Sentry {
	constructor() {
		this.bot = new Discord.Client({
			unknownCommandResponse: false,
			commandPrefix: ';'
		});
		
		this.autoModerator = new AutoModerator(this.bot);
		
		this.db = new Datastore(path.join(__dirname, '../data/data.db'));
		this.db.load();
		
		// Events
		
		this.bot.on('message', message => this.autoModerator.processMessage(message));
		this.bot.on('messageUpdate', (oldMessage, newMessage) => this.autoModerator.processMessage(newMessage));
		// this.bot.on('message', message => this.onMessage(message));
		this.bot.on('messageReactionAdd', this.onReactionAdd.bind(this));
		this.bot.on('ready', this.onReady.bind(this));
		
		// Register commands
		
		this.bot.registry
			.registerGroup('sentry', 'Sentry')
			.registerDefaultTypes()
			.registerCommandsIn(path.join(__dirname, 'commands'));
		
		// Login
		
		this.bot.login(process.env.TOKEN);

		// Expire mutes interval
		setInterval(this.expireMutes.bind(this), 5000);
	}
	
	onReady() {
		this.guild = this.bot.guilds.get(process.env.GUILD_ID);
		this.logGuild = this.bot.guilds.get(process.env.LOG_GUILD_ID);

		this.hookUpLogEvents();

		console.log("Sentry is ready.");
	}

	async onMessage(message) {
		message.channel.overwritePermissions(message.author, {
			SEND_MESSAGES: false
		});

		setTimeout(() => {
			message.channel.overwritePermissions(message.author, {SEND_MESSAGES: null});
		}, 5000);
	}

	async onReactionAdd(reaction, user) {
		let reactor = await Person.new(user.id);
		if (!reactor) return;

		if (!reactor.isModerator()) {
			return;
		}

		reaction.message.delete();

		let person = await Person.new(reaction.message.author.id);
		if (!person) return;

		if (reaction.emoji.id === process.env.MUTE_EMOJI) {
			person.mute({ text: "Inappropriate:", evidence: reaction.message.cleanContent }, reactor.id, reaction.message.channel);
		}
	}

	async expireMutes() {
		let documents = await this.db.find({ muted: { $lte: time() } });

		if (documents === null) {
			return;
		}

		for (let document of documents) {
			let person = await Person.new(document.id);
			if (person) await person.unmute(this.bot.user.id, false);
		}
		
		documents = await this.db.find({ voice_muted: { $lte: time() } });

		if (documents === null) {
			return;
		}

		for (let document of documents) {
			let person = await Person.new(document.id);
			if (person) await person.unVoiceMute(this.bot.user.id, false);
		}
	}

	async log(action, channel) {
		let logChannel = process.env.LOG_MUTES;
		
		action.username = "*no name*";
		if (!action.fields) action.fields = [];
		
		let user = await Person.new(action.id);
		if (user) action.username = user.member.displayName;
		
		let mod = await Person.new(action.modId);
		if (mod) action.modname = mod.member.displayName;
		
		switch (action.type) {
			case "mute":
				action.color = 0xE74C3C;
				action.title = `<${action.username}> has been muted`;
				action.icon  = "http://i.imgur.com/yJFp4bQ.png";
				break;
			case "muteVoice":
				action.color = 0xF1C40F;
				action.title = `<${action.username}> has been voice-muted`;
				action.icon  = "http://i.imgur.com/7B2vj52.png";
				break;
			case "muteRemove":
				action.color = 0xf39c12;
				action.title = `Mute removed from history of <${action.username}>`;
				action.icon  = "http://i.imgur.com/A3RCsrj.png";
				break;
			case "muteRemoveAll":
				action.color = 0xf39c12;
				action.title = `Mute history cleared: <${action.username}>`;
				action.icon  = "http://i.imgur.com/fTuaven.png";
				break;
			case "unmuteManual":
				action.color = 0x2ECC71;
				action.title = `<${action.username}> has been unmuted`;
				action.icon  = "http://i.imgur.com/qAYTZsm.png";
				break;
			case "kick":
				logChannel = process.env.LOG_KICKS;
				action.color = 0xECF0F1;
				action.title = `User kicked: <${action.username}>`;
				action.icon = "http://i.imgur.com/o9VorPw.png";
				break;
			case "ban":
				logChannel = process.env.LOG_KICKS;
				action.color = 0xECF0F1;
				action.title = `User banned: <${action.username}>`;
				action.icon = "http://i.imgur.com/o9VorPw.png";
				break;
		}
		
		action.fields.push({ name: "Discord ID", value: action.id });
		action.fields.push({ name: "Name", value: action.username });
		action.fields.push({ name: "Moderator ID", value: action.modId });
		action.fields.push({ name: "Moderator", value: action.modname });
		
		for (let field of action.fields) {
			field.inline = true;
		}
		
		let embed = {
			title: action.title,
			color: action.color,
			description: action.reason || action.type,
			timestamp: new Date(),
			fields: action.fields,
			thumbnail: { url: action.icon }
		};
		
		this.logGuild.channels.get(logChannel).send({embed});
		
		if (channel && channel.id === process.env.STAFF_COMMANDS_CHANNEL) {
			channel.send({embed});
		}
	}

	hookUpLogEvents() {
		this.bot.on('guildMemberAdd', member => {
			this.logGuild.channels.get(process.env.LOG_JOIN).send(`**Joined:** <@${member.user.id}>`).catch(()=>{});
		});

		this.bot.on('guildMemberRemove', member => {
			this.logGuild.channels.get(process.env.LOG_JOIN).send(`**Left:** <@${member.user.id}>`).catch(()=>{});
		});

		this.bot.on('voiceStateUpdate', (oldMember, newMember) => {
			let message = "";
			if (oldMember.voiceChannel && !newMember.voiceChannel) {
				message = `**${newMember.displayName}** leaves <#${oldMember.voiceChannelID}>`;
			} else if (!oldMember.voiceChannel && newMember.voiceChannel) {
				message = `**${newMember.displayName}** joins <#${newMember.voiceChannelID}>`;
			} else if (oldMember.voiceChannel && newMember.voiceChannel && oldMember.voiceChannelID !== newMember.voiceChannelID) {
				message = `**${newMember.displayName}** moves to <#${newMember.voiceChannelID}>`;
			}

			this.logGuild.channels.get(process.env.LOG_VOICE).send(message).catch(()=>{});
			
			if (newMember.voiceChannel && message !== "") {
				(async function() {
					let person = await Person.new(newMember.user.id);
					if (!person) return;
					
					person.member.setMute(await person.isVoiceMuted());
				})();
			}
		});

		this.bot.on('messageDelete', message => {
			this.logGuild.channels.get(process.env.LOG_CHAT).send({embed:{
				color: 0xe74c3c,
				timestamp: new Date(),
				title: "Message Deleted",
				fields: [
					{
						name: "User",
						inline: true,
						value: message.member.displayName
					},
					{
						name: "Channel",
						inline: true,
						value: `<#${message.channel.id}>`
					},
					{
						name: "Message",
						value: message.cleanContent
					}
				]
			}}).catch(()=>{});
		});

		this.bot.on('messageUpdate', (oldMessage, newMessage) => {
			if (!newMessage.member || !newMessage.member.displayName) {
				return;
			}
			this.logGuild.channels.get(process.env.LOG_CHAT).send({embed:{
				color: 0xf1c40f,
				timestamp: new Date(),
				title: "Message Updated",
				fields: [
					{
						name: "User",
						inline: true,
						value: newMessage.member.displayName
					},
					{
						name: "Channel",
						inline: true,
						value: `<#${newMessage.channel.id}>`
					},
					{
						name: "Before",
						value: oldMessage.cleanContent
					},
					{
						name: "After",
						value: newMessage.cleanContent
					}
				]
			}}).catch(()=>{});
		});
	}
}