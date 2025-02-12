require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const TelegramBot = require('node-telegram-bot-api');
const prisma = new PrismaClient();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const STATUS_OPTIONS = ['planned', 'doing', 'done'];
const CHUNK_SIZE = 20;
const editingTasks = new Map(); // Храним текущие редактируемые задачи

bot.setMyCommands([
    { command: "/actual_tasks", description: "Актуальные задачи (кроме выполненных)" }, // Новая команда
    { command: "/tasks_today", description: "Все задачи созданные/измененные сегодня" },
    { command: "/tasks_yesterday", description: "Все задачи  созданные/измененные вчера" },
    { command: "/tasks_week", description: "Все задачи созданные/измененные на этой неделе" },
    { command: "/tasks_lastweek", description: "Все задачи созданные/измененные на прошлой неделе" },
    { command: "/tasks_month", description: "Все задачи  созданные/измененные в этот месяц" },
    { command: "/tasks_lastmonth", description: "Все задачи созданные/измененные в позапрошлый месяц" },
]);

const getActualTasks = async (telegramId) => {
    return prisma.task.findMany({
        where: {
            userTelegramId: telegramId,
            status: { not: "done" } // Исключаем задачи со статусом "done"
        },
        orderBy: { createdAt: 'desc' }
    });
};

bot.onText(/\/actual_tasks/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const tasks = await getActualTasks(telegramId);
    if (tasks.length === 0) {
        bot.sendMessage(chatId, "Нет актуальных задач.");
        return;
    }

    const messages = chunkTasks(formatTasks(tasks), 10);
    for (const message of messages) {
        bot.sendMessage(chatId, message);
    }
});


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

bot.onText(/\/edit(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const taskId = parseInt(match[1]);

    // Сохраняем задачу в Map
    editingTasks.set(chatId, taskId);

    bot.sendMessage(chatId, "Введите новый текст для задачи:");
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text;

    // Проверяем, редактируется ли сейчас задача
    if (editingTasks.has(chatId)) {
        const taskId = editingTasks.get(chatId);
        editingTasks.delete(chatId); // Удаляем флаг редактирования

        // Проверяем, что это не команда
        if (text.startsWith('/')) {
            bot.sendMessage(chatId, "Редактирование отменено.");
            return;
        }

        try {
            const updatedTask = await prisma.task.update({
                where: { id: taskId },
                data: { text: text, updatedAt: new Date() }
            });

            bot.sendMessage(chatId, `Текст задачи обновлен:\n\n` + generateTaskString(updatedTask));
        } catch (e) {
            bot.sendMessage(chatId, "Ошибка при обновлении задачи.");
        }

        return; // Выходим из обработчика, чтобы не создавать новую задачу
    }

    // Игнорируем команды
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

        bot.sendMessage(chatId, `Задача добавлена!\n\n` + generateTaskString(task));
    } catch (e) {
        bot.sendMessage(chatId, "Ошибка при добавлении задачи.");
    }
});


const options = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Moscow' };
const formatDate = (date) => date.toLocaleString('ru-RU', options).replace('.', '').replace(',', '');
generateTaskString = (task) => {
    const dateStr = `${formatDate(task.createdAt)} - ${formatDate(task.updatedAt)}`;
    return `(${dateStr})\n${task.status === "done" ? "✅": task.status === "doing"? "👨‍💻": "🐣"} ${task.text}\n` +
        `- Ред.: /edit${task.id}\n` +
        `- Удалить: /remove${task.id}\n` +
        `Новый статус:\n` +
        `- /planned${task.id} \n`+  //🐣
        `- /doing${task.id}  \n`+ //👨‍💻
        `- /done${task.id} \n` //✅
}
const sortTasks = (tasks) => {
    const order = { "done": 1, "planned": 2, "doing": 3 };

    return tasks.sort((a, b) => order[a.status] - order[b.status]);
};



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

    const tasks = await getTasks(telegramId, period);
    if (tasks.length === 0) {
        bot.sendMessage(chatId, "Нет задач за выбранный период.");
        return;
    }

    const messages = chunkTasks(formatTasks(tasks), 10);
    for (const message of messages) {
        bot.sendMessage(chatId, message);
    }
});

const formatTasks = (tasks) => {
    let tasksStrings = sortTasks(tasks).map(task => generateTaskString(task));
    return tasksStrings;
};

const chunkTasks = (tasksArray, chunkSize) => {
    let result = [];
    for (let i = 0; i < tasksArray.length; i += chunkSize) {
        result.push(tasksArray.slice(i, i + chunkSize).join("\n\n"));
    }
    return result;
};



console.log("Бот запущен!");
