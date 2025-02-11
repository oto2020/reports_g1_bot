require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const TelegramBot = require('node-telegram-bot-api');
const prisma = new PrismaClient();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const STATUS_OPTIONS = ['planned', 'doing', 'done'];
const CHUNK_SIZE = 10;

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    let user = await prisma.user.findUnique({ where: { telegramId } });
    
    if (!user) {
        bot.sendMessage(chatId, "Пожалуйста, поделитесь своим контактом, используя кнопку ниже.", {
            reply_markup: {
                keyboard: [[{ text: "Поделиться контактом", request_contact: true }]],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        });
    } else {
        bot.sendMessage(chatId, "Добро пожаловать обратно! Вы можете отправлять задачи.");
    }
});

bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const { phone_number, first_name } = msg.contact;
    
    let user = await prisma.user.findUnique({ where: { telegramId } });
    
    if (!user) {
        await prisma.user.create({
            data: {
                telegramId,
                chatId,
                name: first_name,
                phone: phone_number,
            }
        });
        bot.sendMessage(chatId, "Вы успешно зарегистрированы! Теперь отправьте вашу первую задачу.");
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/')) return;
    
    let user = await prisma.user.findUnique({ where: { telegramId } });
    
    if (!user) {
        bot.sendMessage(chatId, "Пожалуйста, сначала поделитесь своим контактом.");
        return;
    }
    
    await prisma.task.create({
        data: {
            userTelegramId: telegramId,
            text,
        }
    });
    
    bot.sendMessage(chatId, "Задача добавлена со статусом 'planned'.");
});

bot.onText(/\/edit(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const taskId = parseInt(match[1]);
    
    bot.sendMessage(chatId, "Введите новый текст для задачи:");
    bot.once('message', async (newMsg) => {
        await prisma.task.update({
            where: { id: taskId },
            data: { text: newMsg.text }
        });
        bot.sendMessage(chatId, "Текст задачи обновлен.");
    });
});

bot.onText(/\/(done|doing|planned)(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const status = match[1];
    const taskId = parseInt(match[2]);
    
    await prisma.task.update({
        where: { id: taskId },
        data: { status }
    });
    
    bot.sendMessage(chatId, `Статус задачи #${taskId} изменен на '${status}'.`);
});

bot.onText(/\/remove(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const taskId = parseInt(match[1]);
    
    await prisma.task.delete({ where: { id: taskId } });
    
    bot.sendMessage(chatId, `Задача #${taskId} удалена.`);
});

const getTasks = async (telegramId, period) => {
    let dateFrom;
    const now = new Date();
    
    switch (period) {
        case 'today':
            dateFrom = new Date(now.setHours(0, 0, 0, 0));
            break;
        case 'week':
            dateFrom = new Date(now.setDate(now.getDate() - 7));
            break;
        case 'month':
            dateFrom = new Date(now.setMonth(now.getMonth() - 1));
            break;
        default:
            return [];
    }
    
    return prisma.task.findMany({
        where: {
            userTelegramId: telegramId,
            createdAt: { gte: dateFrom }
        },
        orderBy: { createdAt: 'desc' }
    });
};

const formatTasks = (tasks) => {
    const grouped = STATUS_OPTIONS.reduce((acc, status) => {
        acc[status] = [];
        return acc;
    }, {});
    
    tasks.forEach(task => {
        grouped[task.status].push(`[${task.createdAt.toLocaleString()}] ${task.text} /edit${task.id} /done${task.id} /doing${task.id} /planned${task.id} /remove${task.id}`);
    });
    
    return STATUS_OPTIONS.map(status =>
        grouped[status].length ? `${status.charAt(0).toUpperCase() + status.slice(1)}:\n` + grouped[status].join('\n') : ""
    ).filter(Boolean).join('\n\n');
};

bot.onText(/\/tasks_(today|week|month)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const period = match[1];
    const telegramId = msg.from.id;
    
    const tasks = await getTasks(telegramId, period);
    if (tasks.length === 0) {
        bot.sendMessage(chatId, "Нет задач за выбранный период.");
        return;
    }
    
    const messages = formatTasks(tasks).match(/(.|\n){1,4096}/g);
    for (const message of messages) {
        bot.sendMessage(chatId, message);
    }
});

console.log("Бот запущен!");
