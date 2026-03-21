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

// === НАСТРОЙКИ (ПРОВЕРЬ СВОИ ДАННЫЕ) ===
const VK_TOKEN = "vk1.a.9IWAg6xUmeHq-2qOjlrAG2nNpYS4s0GYkUrKu8lMwXmrhUSgQnpgdj0cmZrRS13ZwtenBW3dPGW2xZtlpkWchwprwx9rTK1LM0jRpkWd6Xs6eGQgOPJPDfyydEFCiI1vSUXW8JMsk-tDk6h3ujaB8uAdRoXae0seS9CUM6EI53b3ILCTytawu-bJC92CuGWN7hcA3z4rmPUU7nmk02yQcg";
const GROUP_ID = "236017708"; 
// =========================================

const upload = multer({ dest: "uploads/" });

app.get("/captcha-proxy", async (req, res) => {
    try {
        let { src } = req.query;
        const response = await axios.get(src, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        res.json({ data: `data:${response.headers['content-type']};base64,${base64}` });
    } catch (e) { res.status(500).json({ error: "Captcha fail" }); }
});

app.get("/files", async (req, res) => {
    try {
        const response = await axios.get("https://api.vk.com/method/docs.get", { 
            params: { owner_id: -GROUP_ID, access_token: VK_TOKEN, v: "5.131", count: 2000 } 
        });
        res.json(response.data.response.items || []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const { folder_path = "", captcha_sid, captcha_key } = req.body;
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const finalTitle = folder_path ? `${folder_path}/${originalName}` : originalName;

        let serverUrl = `https://api.vk.com/method/docs.getUploadServer?group_id=${GROUP_ID}&access_token=${VK_TOKEN}&v=5.131`;
        if (captcha_sid) serverUrl += `&captcha_sid=${captcha_sid}&captcha_key=${captcha_key}`;

        const serverRes = await axios.get(serverUrl);
        if (serverRes.data.error && serverRes.data.error.error_code === 14) return res.status(403).json(serverRes.data.error);

        const form = new FormData();
        form.append("file", fs.createReadStream(req.file.path), { filename: originalName });
        const uploadRes = await axios.post(serverRes.data.response.upload_url, form, { headers: form.getHeaders() });

        const saveRes = await axios.post("https://api.vk.com/method/docs.save", 
            `file=${uploadRes.data.file}&title=${encodeURIComponent(finalTitle)}&access_token=${VK_TOKEN}&v=5.131`,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json(saveRes.data.response);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/move", async (req, res) => {
    try {
        for (let item of req.body.items) {
            await axios.get("https://api.vk.com/method/docs.edit", { 
                params: { owner_id: -GROUP_ID, doc_id: item.id, title: item.new_title, access_token: VK_TOKEN, v: "5.131" } 
            });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/delete", async (req, res) => {
    try {
        await axios.get("https://api.vk.com/method/docs.delete", { 
            params: { owner_id: -GROUP_ID, doc_id: req.body.doc_id, access_token: VK_TOKEN, v: "5.131" } 
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/download-proxy", async (req, res) => {
    try {
        const { url, title } = req.query;
        const response = await axios({ url, method: 'GET', responseType: 'stream' });
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title.split('/').pop())}"`);
        response.data.pipe(res);
    } catch (e) { res.status(500).send("Error"); }
});

app.listen(3000, () => console.log("Сервер работает на порту 3000"));