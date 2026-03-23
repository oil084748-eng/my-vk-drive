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

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// === НАСТРОЙКИ ===
const VK_TOKEN = "vk1.a.9IWAg6xUmeHq-2qOjlrAG2nNpYS4s0GYkUrKu8lMwXmrhUSgQnpgdj0cmZrRS13ZwtenBW3dPGW2xZtlpkWchwprwx9rTK1LM0jRpkWd6Xs6eGQgOPJPDfyydEFCiI1vSUXW8JMsk-tDk6h3ujaB8uAdRoXae0seS9CUM6EI53b3ILCTytawu-bJC92CuGWN7hcA3z4rmPUU7nmk02yQcg";
const GROUP_ID = "236017708"; 
// =================

const upload = multer({ dest: "uploads/" });

async function requestWithRetry(config, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios(config);
            if (res.data && res.data.error && res.data.error.error_code === 6) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
            return res;
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

app.get("/files", async (req, res) => {
    try {
        const response = await axios.get("https://api.vk.com/method/docs.get", {
            params: { owner_id: -Math.abs(GROUP_ID), access_token: VK_TOKEN, v: "5.131", count: 2000 }
        });
        res.json(response.data.response ? response.data.response.items : []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const { folder_path = "" } = req.body;
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const finalTitle = folder_path ? `${folder_path}/${originalName}` : originalName;

        // 1. Ссылка для загрузки
        const serverRes = await axios.get(`https://api.vk.com/method/docs.getUploadServer`, {
            params: { group_id: GROUP_ID, access_token: VK_TOKEN, v: "5.131" }
        });

        // ПРОВЕРКА НА КАПЧУ ВК
        if (serverRes.data.error && serverRes.data.error.error_code === 14) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(403).json({ 
                error: 'captcha_needed', 
                captcha_img: serverRes.data.error.captcha_img 
            });
        }

        // 2. Сама загрузка
        const form = new FormData();
        form.append("file", fs.createReadStream(req.file.path), { filename: originalName });
        const uploadRes = await axios.post(serverRes.data.response.upload_url, form, { headers: form.getHeaders() });

        // 3. Сохранение
        const saveRes = await axios.post("https://api.vk.com/method/docs.save", null, {
            params: { 
                file: uploadRes.data.file, 
                title: finalTitle, 
                tags: folder_path,
                access_token: VK_TOKEN, 
                v: "5.131" 
            }
        });

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ success: true });
    } catch (e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

app.post("/delete", async (req, res) => {
    try {
        await axios.get("https://api.vk.com/method/docs.delete", {
            params: { owner_id: -Math.abs(GROUP_ID), doc_id: req.body.doc_id, access_token: VK_TOKEN, v: "5.131" }
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/move", async (req, res) => {
    try {
        for (let item of req.body.items) {
            await axios.get("https://api.vk.com/method/docs.edit", {
                params: { owner_id: -Math.abs(GROUP_ID), doc_id: item.id, title: item.new_title, access_token: VK_TOKEN, v: "5.131" }
            });
            await new Promise(r => setTimeout(r, 300));
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/download-proxy", async (req, res) => {
    try {
        const response = await axios({ url: req.query.url, method: 'GET', responseType: 'stream' });
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(req.query.title.split('/').pop())}"`);
        response.data.pipe(res);
    } catch (e) { res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер на порту ${PORT}`));