const express = require("express");
const multer = require("multer");
const cors = require("cors");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Создаем папку для временных файлов, если её нет
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// === НАСТРОЙКИ (ПРОВЕРЬ ИХ ЕЩЕ РАЗ) ===
const VK_TOKEN = "vk1.a.9IWAg6xUmeHq-2qOjlrAG2nNpYS4s0GYkUrKu8lMwXmrhUSgQnpgdj0cmZrRS13ZwtenBW3dPGW2xZtlpkWchwprwx9rTK1LM0jRpkWd6Xs6eGQgOPJPDfyydEFCiI1vSUXW8JMsk-tDk6h3ujaB8uAdRoXae0seS9CUM6EI53b3ILCTytawu-bJC92CuGWN7hcA3z4rmPUU7nmk02yQcg";
const GROUP_ID = "236017708"; // Только цифры! Без минуса в начале.
// =========================================

const upload = multer({ dest: "uploads/" });

// Утилита для пауз
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// УМНАЯ ФУНКЦИЯ ЗАПРОСОВ С ПОВТОРАМИ И ЛОГАМИ
async function requestWithRetry(config, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios(config);
            if (response.data && response.data.error) {
                const errorCode = response.data.error.error_code;
                // Ошибка 6 - слишком много запросов в секунду (Flood Control)
                if (errorCode === 6 && i < retries - 1) {
                    console.log(`[Retry] Лимит запросов. Ждем 1 сек... (Попытка ${i + 1})`);
                    await delay(1000);
                    continue;
                }
            }
            return response;
        } catch (error) {
            if (i === retries - 1) throw error;
            console.log(`[Retry] Ошибка сети. Ждем 1 сек... (Попытка ${i + 1})`);
            await delay(1000);
        }
    }
}

// ПОЛУЧЕНИЕ СПИСКА ФАЙЛОВ (С ГЛУБОКОЙ ДИАГНОСТИКОЙ)
app.get("/files", async (req, res) => {
    try {
        console.log("--> Запрос списка файлов для группы:", GROUP_ID);
        const response = await requestWithRetry({
            method: 'get',
            url: "https://api.vk.com/method/docs.get",
            params: { 
                owner_id: -Math.abs(GROUP_ID), // Гарантируем, что ID будет с одним минусом
                access_token: VK_TOKEN, 
                v: "5.131", 
                count: 2000 
            }
        });

        if (response.data.error) {
            console.error("!!! ВК ВЕРНУЛ ОШИБКУ:", JSON.stringify(response.data.error));
            return res.status(500).json({ error: response.data.error });
        }

        const items = response.data.response.items || [];
        console.log(`<-- Успешно получено файлов: ${items.length}`);
        res.json(items);

    } catch (e) { 
        console.error("!!! КРИТИЧЕСКАЯ ОШИБКА СЕРВЕРА:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});

// НОВЫЙ МЕТОД 1: Выдаем телефону прямую ссылку для загрузки в ВК
app.get('/get-upload-url', async (req, res) => {
    try {
        // Запрашиваем ссылку у ВК
        const response = await axios.get('https://api.vk.com/method/docs.getUploadServer', {
            params: {
                access_token: VK_TOKEN,
                v: '5.131',
                group_id: GROUP_ID // <-- ВОТ ТУТ УБРАЛИ СЛЕШИ И ДОБАВИЛИ ЗАПЯТУЮ СТРОКОЙ ВЫШЕ
            }
        });
        
        if (response.data.response && response.data.response.upload_url) {
            res.json({ upload_url: response.data.response.upload_url });
        } else {
            res.status(400).json({ error: 'ВК не дал ссылку' });
        }
    } catch (error) {
        console.error('Ошибка получения ссылки:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// НОВЫЙ МЕТОД 2: Сохраняем файл в ВК после того, как телефон его туда закинул
app.post('/save-file', upload.none(), async (req, res) => {
    try {
        const { file_data, file_name, folder_path } = req.body;
        
        // Говорим ВК окончательно сохранить файл с нужным именем и тегом (папкой)
        const saveResponse = await axios.post('https://api.vk.com/method/docs.save', null, {
            params: {
                file: file_data,
                title: file_name,
                tags: folder_path, // Мы используем теги для имитации папок
                access_token: VK_TOKEN, // <-- Убедись, что тут имя твоей переменной с токеном
                v: '5.131'
            }
        });
        
        res.json({ success: true, data: saveResponse.data });
    } catch (error) {
        console.error('Ошибка сохранения файла:', error.message);
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

// ПЕРЕИМЕНОВАНИЕ / ПЕРЕНОС
app.post("/move", async (req, res) => {
    try {
        const items = req.body.items || [];
        console.log(`--> Перенос/Переименование ${items.length} объектов`);
        
        for (let item of items) {
            await requestWithRetry({
                method: 'get',
                url: "https://api.vk.com/method/docs.edit",
                params: { 
                    owner_id: -Math.abs(GROUP_ID), 
                    doc_id: item.id, 
                    title: item.new_title, 
                    access_token: VK_TOKEN, 
                    v: "5.131" 
                }
            });
            await delay(250); // Пауза, чтобы не злить ВК
        }
        res.json({ success: true });
    } catch (e) { 
        console.error("!!! ОШИБКА ПЕРЕНОСА:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});

// УДАЛЕНИЕ
app.post("/delete", async (req, res) => {
    try {
        console.log(`--> Удаление файла ID: ${req.body.doc_id}`);
        await requestWithRetry({
            method: 'get',
            url: "https://api.vk.com/method/docs.delete",
            params: { owner_id: -Math.abs(GROUP_ID), doc_id: req.body.doc_id, access_token: VK_TOKEN, v: "5.131" }
        });
        res.json({ success: true });
    } catch (e) { 
        console.error("!!! ОШИБКА УДАЛЕНИЯ:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});

// ПРОКСИ ДЛЯ СКАЧИВАНИЯ
app.get("/download-proxy", async (req, res) => {
    try {
        const { url, title } = req.query;
        const response = await axios({ url, method: 'GET', responseType: 'stream' });
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title.split('/').pop())}"`);
        response.data.pipe(res);
    } catch (e) { res.status(500).send("Error"); }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`--- СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT} ---`));