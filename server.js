const express = require("express");
const multer = require("multer");
const cors = require("cors");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const qs = require("querystring"); // 🔥 ДОБАВИЛИ МОДУЛЬ ДЛЯ КОДИРОВАНИЯ СИМВОЛОВ

const app = express();

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const VK_TOKEN = "vk1.a.9IWAg6xUmeHq-2qOjlrAG2nNpYS4s0GYkUrKu8lMwXmrhUSgQnpgdj0cmZrRS13ZwtenBW3dPGW2xZtlpkWchwprwx9rTK1LM0jRpkWd6Xs6eGQgOPJPDfyydEFCiI1vSUXW8JMsk-tDk6h3ujaB8uAdRoXae0seS9CUM6EI53b3ILCTytawu-bJC92CuGWN7hcA3z4rmPUU7nmk02yQcg";
const GROUP_ID = "236017708"; 

const upload = multer({ dest: "uploads/" });

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// === ИНТЕЛЛЕКТУАЛЬНАЯ ОБЕРТКА API (ТЕПЕРЬ ТОЛЬКО POST) ===
async function vkApi(method, params, body = {}) {
    if (body.captcha_sid && body.captcha_key) {
        params.captcha_sid = body.captcha_sid;
        params.captcha_key = body.captcha_key;
    }

    // 🔥 ВСЕ запросы к ВК теперь идут через POST. Это решает 100% проблем с кавычками, плюсами, ссылками и эмодзи.
    const res = await axios.post(`https://api.vk.com/method/${method}`, qs.stringify(params), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    
    if (res.data.error) {
        if (res.data.error.error_code === 14) {
            throw { type: "captcha", sid: res.data.error.captcha_sid, img: res.data.error.captcha_img };
        }
        throw new Error(res.data.error.error_msg);
    }
    return res.data.response;
}

// === 1. ПОЛУЧЕНИЕ ФАЙЛОВ ===
app.get("/files", async (req, res) => {
    try {
        let allItems = [];
        let offset = 0;
        const count = 2000; 
        let fetchMore = true;

        while (fetchMore) {
            const params = { owner_id: -Math.abs(GROUP_ID), count: count, offset: offset, return_tags: 1, access_token: VK_TOKEN, v: "5.131" };
            if (req.query.captcha_sid) { params.captcha_sid = req.query.captcha_sid; params.captcha_key = req.query.captcha_key; }
            
            const response = await vkApi("docs.get", params, {});
            if (response && response.items && response.items.length > 0) {
                allItems = allItems.concat(response.items); 
                offset += count; 
                if (response.items.length < count) fetchMore = false;
            } else { fetchMore = false; }
        }
        res.json(allItems); 
    } catch (e) {
        if (e.type === "captcha") return res.status(403).json(e);
        res.status(500).json({ error: e.message });
    }
});

// === 2. ЗАГРУЗКА ФАЙЛА ===
app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const uploadServer = await vkApi("docs.getUploadServer", { group_id: Math.abs(GROUP_ID), access_token: VK_TOKEN, v: "5.131" }, req.body);
        const fileName = req.body.original_name || req.file.originalname; 
        const fileStream = fs.createReadStream(req.file.path);
        const form = new FormData();
        form.append("file", fileStream, { filename: fileName }); 
        
        const uploadRes = await axios.post(uploadServer.upload_url, form, { headers: form.getHeaders() });
        fs.unlinkSync(req.file.path); 
        
        const saveRes = await vkApi("docs.save", { file: uploadRes.data.file, title: fileName, tags: req.body.folder_path || "", access_token: VK_TOKEN, v: "5.131" }, req.body);
        res.json({ success: true, file: saveRes.doc });
    } catch (e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (e.type === "captcha") return res.status(403).json(e);
        res.status(500).json({ error: e.message });
    }
});

// === 3. УДАЛЕНИЕ ===
app.post("/delete", async (req, res) => {
    try {
        await vkApi("docs.delete", { owner_id: -Math.abs(GROUP_ID), doc_id: req.body.doc_id, access_token: VK_TOKEN, v: "5.131" }, req.body);
        res.json({ success: true });
    } catch (e) {
        if (e.type === "captcha") return res.status(403).json(e);
        res.status(500).json({ error: e.message });
    }
});

// === 4. ПЕРЕНОС И ПЕРЕИМЕНОВАНИЕ ===
app.post("/move", async (req, res) => {
    try {
        for (let item of req.body.items) {
            await vkApi("docs.edit", { owner_id: -Math.abs(GROUP_ID), doc_id: item.id, title: item.new_title, tags: item.tags, access_token: VK_TOKEN, v: "5.131" }, req.body);
        }
        res.json({ success: true });
    } catch (e) {
        if (e.type === "captcha") return res.status(403).json(e);
        res.status(500).json({ error: e.message });
    }
});

// === 5. ПРОКСИ ДЛЯ СКАЧИВАНИЯ ===
app.get("/download-proxy", async (req, res) => {
    try {
        const response = await axios({ url: req.query.url, method: 'GET', responseType: 'stream', timeout: 60000 });
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(req.query.title)}`);
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (e) { res.status(500).send("Proxy error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));