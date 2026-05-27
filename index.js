import { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, SlashCommandBuilder, ActivityType } from 'discord.js';
import { QuickDB } from 'quick.db';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { config } from './config.js';

const db = new QuickDB();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();
const { TOKEN, CLIENT_ID } = config;

// ====================================================================
// 📊 KÜRESEL SLASH KOMUTLARININ TANIMLARI VE AÇIKLAMALARI
// ====================================================================

const commandsData = [
    // 1. Yardım Menüsü
    {
        data: new SlashCommandBuilder()
            .setName('yardim')
            .setDescription('EmirhanBOT Premium+ interaktif yardım ve komut merkezini açar.'),
        async execute(interaction) {
            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('🤖 EmirhanBOT Premium+ Komut Merkezi')
                .setDescription('Botun tüm fonksiyonlarını yönetmek ve bilgi almak için aşağıdaki butonları kullanabilirsiniz.');

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('help_moderasyon').setLabel('Moderasyon').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('help_destek').setLabel('Destek').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('help_sunucu').setLabel('Sunucu').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('help_premium').setLabel('Premium+').setStyle(ButtonStyle.Success)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('help_log').setLabel('Log Ayarları').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('help_home').setLabel('Ana Panel').setStyle(ButtonStyle.Primary)
            );

            await interaction.reply({ embeds: [embed], components: [row1, row2] });
        }
    },

    // 2. Kademeli Uyarı Sistemi Kurulumu
    {
        data: new SlashCommandBuilder()
            .setName('uyari_ayarla')
            .setDescription('Kademeli ceza sistemi (U1, U2, U3) rollerini ve susturma süresini dinamik olarak belirler.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addRoleOption(o => o.setName('u1').setDescription('1. ihlalde verilecek hafif ceza rolü').setRequired(true))
            .addRoleOption(o => o.setName('u2').setDescription('2. ihlalde verilecek orta ceza rolü').setRequired(true))
            .addRoleOption(o => o.setName('u3').setDescription('3. ihlalde verilecek ağır ceza (JAIL) rolü').setRequired(true))
            .addIntegerOption(o => o.setName('mute_suresi').setDescription('3. Uyarı sınırına ulaşan üyenin kaç dakika susturulacağını (Timeout) belirler.').setRequired(true)),
        async execute(interaction) {
            const guildId = interaction.guildId;
            const configData = {
                u1: interaction.options.getRole('u1').id,
                u2: interaction.options.getRole('u2').id,
                u3: interaction.options.getRole('u3').id,
                mute: interaction.options.getInteger('mute_suresi')
            };
            await db.set(`warn_config_${guildId}`, configData);
            return interaction.reply({ content: `✅ **Kademeli Uyarı Sistemi Kuruldu!**\nU1, U2 ve U3 (Jail) rolleri kaydedildi. 3. ihlalde ${configData.mute} dakika ceza uygulanacak.`, ephemeral: true });
        }
    },

    // 3. Uyarı Ver
    {
        data: new SlashCommandBuilder()
            .setName('uyari_ver')
            .setDescription('Kullanıcıya kademeli uyarı cezası uygular, otomatik rol verir ve siciline işler.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .addUserOption(o => o.setName('kullanici').setDescription('Uyarılacak ve ceza uygulanacak sunucu üyesi').setRequired(true))
            .addStringOption(o => o.setName('sebep').setDescription('Ceza paneline işlenecek uyarı gerekçesi').setRequired(true)),
        async execute(interaction) {
            const guildId = interaction.guildId;
            const target = interaction.options.getMember('kullanici');
            const reason = interaction.options.getString('sebep');

            const configData = await db.get(`warn_config_${guildId}`);
            if (!configData) return interaction.reply({ content: '❌ Lütfen önce `/uyari_ayarla` komutunu çalıştırın.', ephemeral: true });

            let warns = (await db.get(`warns_${guildId}_${target.id}`)) || 0;
            warns += 1;
            await db.set(`warns_${guildId}_${target.id}`, warns);

            let logTxt = '';
            if (warns === 1) {
                await target.roles.add(configData.u1).catch(() => {});
                logTxt = 'U1 Rolü Tanımlandı.';
            } else if (warns === 2) {
                await target.roles.remove(configData.u1).catch(() => {});
                await target.roles.add(configData.u2).catch(() => {});
                logTxt = 'U1 Alındı, U2 Rolü Tanımlandı.';
            } else if (warns >= 3) {
                await target.roles.remove(configData.u2).catch(() => {});
                await target.roles.add(configData.u3).catch(() => {});
                await target.timeout(configData.mute * 60 * 1000, '3. Kademe Uyarı Sınırı').catch(() => {});
                logTxt = `U2 Alındı, U3 (JAIL) Verildi ve ${configData.mute} Dakika Susturuldu.`;
            }

            const embed = new EmbedBuilder()
                .setColor(0xffaa00)
                .setTitle('⚖️ Ceza İşlemi Bilgisi')
                .setDescription(`**Kullanıcı:** ${target}\n**Yetkili:** ${interaction.user}\n**Toplam Uyarı:** ${warns}\n**Sebep:** ${reason}\n**Yapılan İşlem:** ${logTxt}`);

            const modLogId = await db.get(`mod_log_${guildId}`);
            if (modLogId) {
                const chan = interaction.guild.channels.cache.get(modLogId);
                if (chan) chan.send({ embeds: [embed] }).catch(() => {});
            }

            return interaction.reply({ embeds: [embed] });
        }
    },

    // 4. Uyarı Kaldır
    {
        data: new SlashCommandBuilder()
            .setName('uyari_kaldir')
            .setDescription('Kullanıcının tüm uyarı sicilini sıfırlar ve üzerindeki aktif cezalı rolleri temizler.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .addUserOption(o => o.setName('kullanici').setDescription('Sicili ve cezalı rolleri tamamen sıfırlanacak üye').setRequired(true)),
        async execute(interaction) {
            const guildId = interaction.guildId;
            const target = interaction.options.getMember('kullanici');
            const configData = await db.get(`warn_config_${guildId}`);

            await db.delete(`warns_${guildId}_${target.id}`);
            if (configData) {
                await target.roles.remove([configData.u1, configData.u2, configData.u3]).catch(() => {});
            }
            return interaction.reply({ content: `✅ ${target} isimli üyenin sicili temizlendi ve rolleri geri alındı.` });
        }
    },

    // 5. Uyarı Bilgi
    {
        data: new SlashCommandBuilder()
            .setName('uyari_bilgi')
            .setDescription('Bir kullanıcının sunucuda kaç adet aktif uyarısı olduğunu sorgular.')
            .addUserOption(o => o.setName('kullanici').setDescription('Uyarı adedi sorgulanacak sunucu üyesi').setRequired(true)),
        async execute(interaction) {
            const guildId = interaction.guildId;
            const target = interaction.options.getUser('kullanici');
            const warns = (await db.get(`warns_${guildId}_${target.id}`)) || 0;

            return interaction.reply({ content: `📋 ${target} kullanıcısının bu sunucuda toplam **${warns}** uyarısı bulunuyor.` });
        }
    },

    // 6. Ban Komutu
    {
        data: new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Belirtilen üyeyi sunucudan bir daha girmemek üzere kalıcı olarak yasaklar.')
            .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
            .addUserOption(o => o.setName('kullanici').setDescription('Sunucudan kalıcı olarak yasaklanacak üye').setRequired(true))
            .addStringOption(o => o.setName('sebep').setDescription('Yasaklama paneline işlenecek haklı gerekçe')),
        async execute(interaction) {
            const target = interaction.options.getMember('kullanici');
            const reason = interaction.options.getString('sebep') || 'Gerekçe belirtilmedi.';
            await target.ban({ reason });
            return interaction.reply({ content: `🔨 ${target.user.tag} başarıyla yasaklandı. Gerekçe: ${reason}` });
        }
    },

    // 7. Kick Komutu
    {
        data: new SlashCommandBuilder()
            .setName('kick')
            .setDescription('Belirtilen üyeyi sunucudan atar (Üye daha sonra tekrar katılabilir).')
            .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
            .addUserOption(o => o.setName('kullanici').setDescription('Sunucudan atılacak üye').setRequired(true))
            .addStringOption(o => o.setName('sebep').setDescription('Atılma paneline işlenecek gerekçe')),
        async execute(interaction) {
            const target = interaction.options.getMember('kullanici');
            const reason = interaction.options.getString('sebep') || 'Gerekçe belirtilmedi.';
            await target.kick(reason);
            return interaction.reply({ content: `🚪 ${target.user.tag} sunucudan atıldı. Gerekçe: ${reason}` });
        }
    },

    // 8. Sustur Komutu
    {
        data: new SlashCommandBuilder()
            .setName('sustur')
            .setDescription('Üyeyi belirtilen süre boyunca kanallarda yazı yazmaktan ve sese girmekten men eder (Timeout).')
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
            .addUserOption(o => o.setName('kullanici').setDescription('Geçici olarak susturulacak üye').setRequired(true))
            .addIntegerOption(o => o.setName('sure').setDescription('Dakika cinsinden susturma süresi').setRequired(true))
            .addStringOption(o => o.setName('sebep').setDescription('Susturma gerekçesi')),
        async execute(interaction) {
            const target = interaction.options.getMember('kullanici');
            const mins = interaction.options.getInteger('sure');
            const reason = interaction.options.getString('sebep') || 'Gerekçe belirtilmedi.';
            await target.timeout(mins * 60 * 1000, reason);
            return interaction.reply({ content: `🔇 ${target} üyesi ${mins} dakika boyunca susturuldu.` });
        }
    },

    // 9. Susturma Kaldır Komutu
    {
        data: new SlashCommandBuilder()
            .setName('susturma_kaldir')
            .setDescription('Üyenin üzerinde bulunan aktif susturma (Timeout) cezasını erken sonlandırır.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
            .addUserOption(o => o.setName('kullanici').setDescription('Susturma cezası erken kaldırılacak üye').setRequired(true)),
        async execute(interaction) {
            const target = interaction.options.getMember('kullanici');
            await target.timeout(null);
            return interaction.reply({ content: `🔊 ${target} kullanıcısının susturulma cezası kaldırıldı.` });
        }
    },

    // 10. Temizle Komutu
    {
        data: new SlashCommandBuilder()
            .setName('temizle')
            .setDescription('Mevcut kanaldaki eski veya uygunsuz mesajları toplu olarak silerek temizler.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .addIntegerOption(o => o.setName('miktar').setDescription('Silinecek mesaj adedi (1 ile 100 arası)').setRequired(true)),
        async execute(interaction) {
            const amount = interaction.options.getInteger('miktar');
            await interaction.channel.bulkDelete(amount, true);
            return interaction.reply({ content: `🧹 Kanal temizlendi: **${amount}** mesaj imha edildi.`, ephemeral: true });
        }
    },

    // 11. Kanal Komut Grubu (Kilit, Aç, Yavaş Mod)
    {
        data: new SlashCommandBuilder()
            .setName('kanal')
            .setDescription('Yazı kanallarını kilitler, kilitleri açar veya üyelere yazma sınırı (Yavaş mod) getirir.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
            .addSubcommand(s => s.setName('kilitle').setDescription('Kanalı normal üyelere tamamen mesaj gönderimine kapatır.'))
            .addSubcommand(s => s.setName('ac').setDescription('Kilitli kanalı normal üyelerin tekrar yazabileceği hale getirir.'))
            .addSubcommand(s => s.setName('yavas_mod').setDescription('Üyelerin ardışık mesaj gönderme aralığını (saniye) ayarlar.').addIntegerOption(o => o.setName('saniye').setDescription('Mesaj gönderme aralığı süresi (Saniye)').setRequired(true))),
        async execute(interaction) {
            const sub = interaction.options.getSubcommand();
            if (sub === 'kilitle') {
                await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
                return interaction.reply({ content: '🔒 Kanal üyelere kapatıldı.' });
            }
            if (sub === 'ac') {
                await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
                return interaction.reply({ content: '🔓 Kanal tekrar kullanıma açıldı.' });
            }
            if (sub === 'yavas_mod') {
                const sec = interaction.options.getInteger('saniye');
                await interaction.channel.setRateLimitPerUser(sec);
                return interaction.reply({ content: `⏳ Kanal yavaş modu **${sec}** saniye olarak güncellendi.` });
            }
        }
    },

    // 12. Otorol Aktifleştir
    {
        data: new SlashCommandBuilder()
            .setName('otorol_aktiflestir')
            .setDescription('Sunucuya yeni katılan kullanıcılara otomatik olarak atanacak rolü belirler.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addRoleOption(o => o.setName('rol').setDescription('Yeni gelen üyelere otomatik verilecek rol').setRequired(true)),
        async execute(interaction) {
            const role = interaction.options.getRole('rol');
            await db.set(`autorole_${interaction.guildId}`, role.id);
            return interaction.reply({ content: `🎯 Otorol sistemi aktif: Yeni üyelere artık <@&${role.id}> rolü verilecek.` });
        }
    },

    // 13. Premium+ Koruma Ayarları
    {
        data: new SlashCommandBuilder()
            .setName('koruma_ayarla')
            .setDescription('Reklam, küfür, spam filtreleri ve şüpheli yeni hesap korumalarını tek bir panelden yönetir.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(o => o.setName('reklam').setDescription('Link ve discord davet koruma filtresi').setRequired(true).addChoices({ name: 'Aç', value: 'Ac' }, { name: 'Kapat', value: 'Kapat' }))
            .addStringOption(o => o.setName('kufur').setDescription('Genel küfür ve hakaret koruma filtresi').setRequired(true).addChoices({ name: 'Aç', value: 'Ac' }, { name: 'Kapat', value: 'Kapat' }))
            .addStringOption(o => o.setName('yeni_hesap').setDescription('Şüpheli yeni kurulan hesap engelleme sistemi').setRequired(true).addChoices({ name: 'Aç', value: 'Ac' }, { name: 'Kapat', value: 'Kapat' }))
            .addChannelOption(o => o.setName('log_kanali').setDescription('Otomatik filtre ihlallerinin loglanacağı rapor kanalı').setRequired(true))
            .addIntegerOption(o => o.setName('gün_siniri').setDescription('Yeni hesapların sunucuya girebilmesi için minimum hesap yaşı (Gün)'))
            .addStringOption(o => o.setName('ceza').setDescription('Limit altı yeni hesap sunucuya girdiğinde uygulanacak işlem').addChoices({ name: 'Sadece Logla', value: 'Log' }, { name: 'Sunucudan At (Kick)', value: 'Cezalandir' })),
        async execute(interaction) {
            const guildId = interaction.guildId;
            const settings = {
                reklam_koruma: interaction.options.getString('reklam'),
                kufur_koruma: interaction.options.getString('kufur'),
                yeni_hesap_koruma: interaction.options.getString('yeni_hesap'),
                yeni_hesap_gun: interaction.options.getInteger('gün_siniri') || 7,
                yeni_hesap_ceza: interaction.options.getString('ceza') || 'Log'
            };
            const logChannel = interaction.options.getChannel('log_kanali');

            await db.set(`settings_${guildId}`, settings);
            await db.set(`automod_log_${guildId}`, logChannel.id);

            return interaction.reply({ content: `⚙️ **Güvenlik Filtreleri Güncellendi!**\nReklam: ${settings.reklam_koruma} | Küfür: ${settings.kufur_koruma} | Şüpheli Hesap: ${settings.yeni_hesap_koruma} (${settings.yeni_hesap_gun} gün)\nLog Kanalı: ${logChannel}` });
        }
    },

    // 14. Bilet Sistemi Kurulumu
    {
        data: new SlashCommandBuilder()
            .setName('bilet_aktiflestir')
            .setDescription('Kullanıcıların tek tıkla gizli canlı destek (Ticket) odası açmasını sağlayan paneli kurar.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addChannelOption(o => o.setName('gonderilecek_kanal').setDescription('Destek talebi butonunun gönderileceği sabit yazı kanalı').addChannelTypes(ChannelType.GuildText).setRequired(true))
            .addRoleOption(o => o.setName('yetkili_rol').setDescription('Açılan özel bilet odalarını görebilecek destek ekibi rolü').setRequired(true))
            .addChannelOption(o => o.setName('bilet_log').setDescription('Bilet açma, kapama ve işlem geçmişinin loglanacağı kanal').addChannelTypes(ChannelType.GuildText).setRequired(true)),
        async execute(interaction) {
            const guildId = interaction.guildId;
            const panelChannel = interaction.options.getChannel('gonderilecek_kanal');
            const role = interaction.options.getRole('yetkili_rol');
            const logChannel = interaction.options.getChannel('bilet_log');

            await db.set(`ticket_config_${guildId}`, { roleId: role.id, logId: logChannel.id });

            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('🎫 Canlı Destek Talebi')
                .setDescription('Sunucu yönetimiyle iletişime geçmek, şikayet bildirmek veya başvuru yapmak için aşağıdaki butona basın.');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('create_ticket').setLabel('Destek Talebi Aç').setStyle(ButtonStyle.Primary).setEmoji('🎫')
            );

            await panelChannel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: `✅ Canlı destek paneli ${panelChannel} kanalına başarıyla aktarıldı.`, ephemeral: true });
        }
    },

    // 15. Gelişmiş Sistem Rapor Logları
    {
        data: new SlashCommandBuilder()
            .setName('log')
            .setDescription('Sunucu içindeki yetkili faaliyetlerini ve komut geçmişlerini kayıt altına alır.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addSubcommand(s => s.setName('komut_aktiflestir').setDescription('Kullanıcıları