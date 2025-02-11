require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const TelegramBot = require('node-telegram-bot-api');
const prisma = new PrismaClient();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const STATUS_OPTIONS = ['planned', 'doing', 'done'];
const CHUNK_SIZE = 10;

bot.setMyCommands([
    { command: "/tasks_today", description: "Задачи по которым работал сегодня" },
    { command: "/tasks_yesterday", description: "Задачи  по которым работал вчера" },
    { command: "/tasks_week", description: "Задачи по которым работал на этой неделе" },
    { command: "/tasks_lastweek", description: "Задачи по которым работал на прошлой неделе" },
    { command: "/tasks_month", description: "Задачи  по которым работал в этот месяц" },
    { command: "/tasks_lastmonth", description: "Задачи по которым работал в позапрошлый месяц" }
]);

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
        try {
            await prisma.user.create({
                data: {
                    telegramId,
                    chatId,
                    name: first_name,
                    phone: phone_number,
                }
            });
            bot.sendMessage(chatId, "Вы успешно зарегистрированы! Теперь отправьте вашу первую задачу.");
        } catch (e) {
            bot.sendMessage(chatId, "Ошибка при регистрации.");
        }
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
    
    try {
        const task = await prisma.task.create({
            data: {
                userTelegramId: telegramId,
                text,
            }
        });
        
        bot.sendMessage(chatId, `Задача добавлена!\n\n` +
            `${task.status === "done" ? "✅": task.status === "doing"? "👨‍💻": "🐣"} ${task.text}\n` +
            `- Редактировать: /edit${task.id}\n` +
            `- Удалить: /remove${task.id}\n` +
            `- Новый статус: 
            🐣 /planned${task.id}, 
            👨‍💻 /doing${task.id}, 
            ✅ /done${task.id}\n` +
            `[${task.createdAt.toLocaleDateString()} - ${task.updatedAt.toLocaleDateString()}]`
        );
    } catch (e) {
        bot.sendMessage(chatId, "Ошибка при добавлении задачи.");
    }
    
});

bot.onText(/\/edit(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const taskId = parseInt(match[1]);
    
    bot.sendMessage(chatId, "Введите новый текст для задачи:");
    bot.once('message', async (newMsg) => {
        try {
            await prisma.task.update({
                where: { id: taskId },
                data: { text: newMsg.text }
            });
            bot.sendMessage(chatId, "Текст задачи обновлен.");
        } catch (e) {
            bot.sendMessage(chatId, "Ошибка при обновлении задачи.");
        }
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
    
    try {
        await prisma.task.delete({ where: { id: taskId } });
        bot.sendMessage(chatId, `Задача #${taskId} удалена.`);
    } catch (e) {
        bot.sendMessage(chatId, `Задача #${taskId} не найдена.`);
    }
});

const getTasks = async (telegramId, period) => {
    let dateFrom, dateTo;
    const now = new Date();
    
    switch (period) {
        case 'today':
            dateFrom = new Date(now.setHours(0, 0, 0, 0));
            dateTo = new Date(now.setHours(23, 59, 59, 999));
            break;
        case 'yesterday':
            dateFrom = new Date(now.setDate(now.getDate() - 1));
            dateFrom.setHours(0, 0, 0, 0);
            dateTo = new Date(now.setHours(23, 59, 59, 999));
            break;
        case 'week':
            dateFrom = new Date(now.setDate(now.getDate() - now.getDay() + 1));
            dateFrom.setHours(0, 0, 0, 0);
            dateTo = new Date(now.setDate(dateFrom.getDate() + 6));
            dateTo.setHours(23, 59, 59, 999);
            break;
        case 'lastweek':
            dateFrom = new Date(now.setDate(now.getDate() - now.getDay() - 6));
            dateFrom.setHours(0, 0, 0, 0);
            dateTo = new Date(now.setDate(dateFrom.getDate() + 6));
            dateTo.setHours(23, 59, 59, 999);
            break;
        case 'month':
            dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
            dateTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            break;
        case 'lastmonth':
            dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            dateTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
            break;
        default:
            return [];
    }
    
    return prisma.task.findMany({
        where: {
            userTelegramId: telegramId,
            OR: [
                { createdAt: { gte: dateFrom, lte: dateTo } },
                { updatedAt: { gte: dateFrom, lte: dateTo } }
            ]
        },
        orderBy: { createdAt: 'desc' }
    });
};

bot.onText(/\/tasks_(today|yesterday|week|lastweek|month|lastmonth)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const period = match[1];
    const telegramId = msg.from.id;
    
    console.log(period);
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

const formatTasks = (tasks) => {
    const grouped = STATUS_OPTIONS.reduce((acc, status) => {
        acc[status] = [];
        return acc;
    }, {});
    
    tasks.forEach(task => {
        grouped[task.status].push(
            `${task.status === "done" ? "✅": task.status === "doing"? "👨‍💻": "🐣"} ${task.text}\n` +
            `- Редактировать: /edit${task.id}\n` +
            `- Удалить: /remove${task.id}\n` +
            `- Новый статус: 
            🐣 /planned${task.id}, 
            👨‍💻 /doing${task.id}, 
            ✅ /done${task.id}\n` +
            `[${task.createdAt.toLocaleDateString()} - ${task.updatedAt.toLocaleDateString()}]\n`);
    });
    
    return STATUS_OPTIONS.map(status =>
        grouped[status].length ? `${status==="planned" ? "<--- НЕ В РАБОТЕ --->" : status==="doing" ? "<--- ДЕЛАЮ --->": "<--- ЗАВЕРШЕНО --->"}\n` + grouped[status].join('\n') : ""
    ).filter(Boolean).join('\n\n');
};
console.log("Бот запущен!");
