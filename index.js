

const TelegramBot = require('node-telegram-bot-api');
const token = '8251415411:AAGK_TrWzqNVg4dHbQf_6Y8ZXpwVWQP_I5U';
const webAppUrl = 'https://habit-tracker-tma.vercel.app/'
const bot = new TelegramBot(token, {polling: true});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if(text === '/start'){
    await bot.sendMessage(chatId, 'Запустите habit-tracker', {
        reply_markup: {
            keyboard: [
                [{text: 'Получите информацию о бота'}]
            ]
        }
    })

    await bot.sendMessage(chatId, 'Запустите habit-tracker', {
        reply_markup: {
            inline_keyboard: [
                [{text: 'Сюда', web_app: {url: webAppUrl}}]
            ]
        }
    })
  }
});