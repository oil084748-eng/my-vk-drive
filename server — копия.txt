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
app.use(express.urlencoded({ extended: true })); // Поддержка form-data

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const VK_TOKEN = "vk1.a.9IWAg6xUmeHq-2qOjlrAG2nNpYS4s0GYkUrKu8lMwXmrhUSgQnpgdj0cmZrRS13ZwtenBW3dPGW2xZtlpkWchwprwx9rTK1LM0jRpkWd6Xs6eGQgOPJPDfyydEFCiI1vSUXW8JMsk-tDk6h3ujaB8uAdRoXae0seS9CUM6EI53b3ILCTytawu-bJC92CuGWN7hcA3z4rmPUU7nmk02yQcg";
const GROUP_ID = "236017708"; 

const upload = multer({ dest: "uploads/" });

/**
 * 🔥 ГЛАВНОЕ ИСПРАВЛЕНИЕ:
 * Все запросы к ВК теперь идут строго через POST. 
 * Токены SmartCaptcha слишком длинные для GET-запросов и ломали API.
 */
async function vkApi(method, params, reqBody = {}) {
    const apiParams = new URLSearchParams();
    apiParams.append("access_token", VK_TOKEN);
    apiParams.append("v", "5.131");
    
    for (const key in params) {
        apiParams.append(key, params[key]);
    }

    // Достаем капчу из тела запроса (req.body)
    const captcha_sid = reqBody.captcha_sid || params.captcha_sid;
    const captcha_key = reqBody.captcha_key || params.captcha_key;

    if (captcha_sid) apiParams.append("captcha_sid", captcha_sid);
    if (captcha_key) apiParams.append("captcha_key", captcha_key);

    try {
        const res = await axios.post(`https://api.vk.com/method/${method}`, apiParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        if (res.data.error) {
            if (res.data.error.error_code === 14) {
                console.log(`[VK API] ВК запросил SmartCaptcha для метода ${method}`);
                throw { type: "captcha", sid: res.data.error.captcha_sid };
            }
            throw new Error(res.data.error.error_msg);
        }
        return res.data.response;
    } catch (e) {
        throw e;
    }
}

app.get("/files", async (req, res) => {
    try {
        let allItems = [], offset = 0, count = 2000, fetchMore = true;
        while (fetchMore) {
            const response = await vkApi("docs.get", { owner_id: -Math.abs(GROUP_ID), count, offset, return_tags: 1 }, req.query);
            if (response && response.items && response.items.length > 0) {
                allItems = allItems.concat(response.items);
                offset += count;
                if (response.items.length < count) fetchMore = false;
            } else fetchMore = false;
        }
        res.json(allItems);
    } catch (e) {
        if (e.type === "captcha") return res.status(403).json(e);
        res.status(500).json({ error: e.message });
    }
});

app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) throw new Error("Файл не дошел до сервера");
        
        const realFileName = req.body.original_name || req.file.originalname;
        
        // Получаем сервер загрузки (капча здесь бывает крайне редко)
        const uploadServer = await vkApi("docs.getUploadServer", { group_id: Math.abs(GROUP_ID) });
        
        const form = new FormData();
        form.append("file", fs.createReadStream(req.file.path), { filename: "file" + path.extname(req.file.originalname) });
        
        const uploadRes = await axios.post(uploadServer.upload_url, form, { 
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });
        
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        if (!uploadRes.data || !uploadRes.data.file) throw new Error("ВК отклонил файл");

        // Сохраняем файл в ВК (99% случаев капча вылетает ИМЕННО ЗДЕСЬ)
        // Мы прокидываем req.body, чтобы токен капчи попал именно в этот запрос!
        const saveRes = await vkApi("docs.save", { 
            file: uploadRes.data.file, 
            title: realFileName, 
            tags: req.body.folder_path || "" 
        }, req.body);

        res.json({ success: true, file: saveRes.doc });
    } catch (e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (e.type === "captcha") return res.status(403).json(e);
        res.status(500).json({ error: e.message });
    }
});

app.post("/delete", async (req, res) => {
    try {
        await vkApi("docs.delete", { owner_id: -Math.abs(GROUP_ID), doc_id: req.body.doc_id }, req.body);
        res.json({ success: true });
    } catch (e) {
        if (e.type === "captcha") return res.status(403).json(e);
        res.status(500).json({ error: e.message });
    }
});

app.post("/move", async (req, res) => {
    try {
        for (let item of req.body.items) {
            await vkApi("docs.edit", { owner_id: -Math.abs(GROUP_ID), doc_id: item.id, title: item.new_title, tags: item.tags }, req.body);
        }
        res.json({ success: true });
    } catch (e) {
        if (e.type === "captcha") return res.status(403).json(e);
        res.status(500).json({ error: e.message });
    }
});

app.get("/download-proxy", async (req, res) => {
    try {
        const response = await axios({ url: req.query.url, method: 'GET', responseType: 'stream' });
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(req.query.title)}`);
        response.data.pipe(res);
    } catch (e) { res.status(500).send("Proxy error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API Server with POST verification running on port ${PORT}`));