const express = require("express");
const multer = require("multer");
const cors = require("cors");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const app = express();

// Настройки CORS
app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Токен и ID группы
const VK_TOKEN = "vk1.a.9IWAg6xUmeHq-2qOjlrAG2nNpYS4s0GYkUrKu8lMwXmrhUSgQnpgdj0cmZrRS13ZwtenBW3dPGW2xZtlpkWchwprwx9rTK1LM0jRpkWd6Xs6eGQgOPJPDfyydEFCiI1vSUXW8JMsk-tDk6h3ujaB8uAdRoXae0seS9CUM6EI53b3ILCTytawu-bJC92CuGWN7hcA3z4rmPUU7nmk02yQcg";
const GROUP_ID = "236017708"; 

const upload = multer({ dest: "uploads/" });

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// === 1. ПОЛУЧЕНИЕ СПИСКА ФАЙЛОВ ===
app.get("/files", async (req, res) => {
    try {
        const response = await axios.get("https://api.vk.com/method/docs.get", {
            params: { 
                owner_id: -Math.abs(GROUP_ID), 
                access_token: VK_TOKEN, 
                v: "5.131", 
                count: 2000,
                return_tags: 1 // <--- КРИТИЧЕСКИ ВАЖНО: просим ВК вернуть метки для папок
            },
            timeout: 15000 
        });

        if (response.data.error) {
            console.error("!!! Ошибка ВК API:", response.data.error.error_msg);
            return res.status(400).json({ error: response.data.error.error_msg });
        }

        res.json(response.data.response ? response.data.response.items : []);
    } catch (e) { 
        console.error("!!! Ошибка /files:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});

// === 2. ЗАГРУЗКА ФАЙЛА ===
app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Файл не получен" });
        
        const { folder_path = "" } = req.body;
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        
        console.log(`--> Загрузка: ${originalName} в папку (тег): ${folder_path}`);

        // Получаем сервер ВК
        const serverRes = await axios.get(`https://api.vk.com/method/docs.getUploadServer`, {
            params: { group_id: GROUP_ID, access_token: VK_TOKEN, v: "5.131" },
            timeout: 15000
        });

        if (serverRes.data.error) throw new Error(serverRes.data.error.error_msg);

        // Отправляем файл на сервер ВК
        const form = new FormData();
        form.append("file", fs.createReadStream(req.file.path), { filename: originalName });
        
        const uploadRes = await axios.post(serverRes.data.response.upload_url, form, { 
            headers: form.getHeaders(),
            timeout: 300000, // Таймаут 5 минут для больших файлов
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        // Сохраняем в ВК: имя отдельно, путь в метках
        const saveRes = await axios.post("https://api.vk.com/method/docs.save", null, {
            params: { 
                file: uploadRes.data.file, 
                title: originalName, 
                tags: folder_path, 
                access_token: VK_TOKEN, 
                v: "5.131" 
            },
            timeout: 20000
        });

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        
        console.log(`Успешно сохранено: ${originalName}`);
        res.json({ success: true, data: saveRes.data });
    } catch (e) {
        console.error("!!! Ошибка /upload:", e.message);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

// === 3. УДАЛЕНИЕ ===
app.post("/delete", async (req, res) => {
    try {
        await axios.get("https://api.vk.com/method/docs.delete", {
            params: { owner_id: -Math.abs(GROUP_ID), doc_id: req.body.doc_id, access_token: VK_TOKEN, v: "5.131" }
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// === 4. ПЕРЕИМЕНОВАНИЕ И ПЕРЕНОС ===
app.post("/move", async (req, res) => {
    try {
        for (let item of req.body.items) {
            await axios.get("https://api.vk.com/method/docs.edit", {
                params: { 
                    owner_id: -Math.abs(GROUP_ID), 
                    doc_id: item.id, 
                    title: item.new_title, 
                    tags: item.tags, // Обновляем путь в метках
                    access_token: VK_TOKEN, 
                    v: "5.131" 
                }
            });
        }
        res.json({ success: true });
    } catch (e) { 
        console.error("!!! Ошибка /move:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});

// === 5. ПРОКСИ ДЛЯ СКАЧИВАНИЯ ===
app.get("/download-proxy", async (req, res) => {
    try {
        const response = await axios({ 
            url: req.query.url, 
            method: 'GET', 
            responseType: 'stream',
            timeout: 60000 
        });
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(req.query.title)}"`);
        response.data.pipe(res);
    } catch (e) { res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});