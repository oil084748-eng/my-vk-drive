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
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const VK_TOKEN = "vk1.a.9IWAg6xUmeHq-2qOjlrAG2nNpYS4s0GYkUrKu8lMwXmrhUSgQnpgdj0cmZrRS13ZwtenBW3dPGW2xZtlpkWchwprwx9rTK1LM0jRpkWd6Xs6eGQgOPJPDfyydEFCiI1vSUXW8JMsk-tDk6h3ujaB8uAdRoXae0seS9CUM6EI53b3ILCTytawu-bJC92CuGWN7hcA3z4rmPUU7nmk02yQcg";
const GROUP_ID = "236017708"; 

const upload = multer({ dest: "uploads/" });

async function vkApi(method, params, reqBody = {}) {
    const apiParams = new URLSearchParams();
    apiParams.set("access_token", VK_TOKEN);
    apiParams.set("v", "5.131");
    
    for (const key in params) {
        apiParams.set(key, params[key]); 
    }

    const captcha_sid = reqBody.captcha_sid || params.captcha_sid;
    const captcha_key = reqBody.captcha_key || params.captcha_key;
    const success_token = reqBody.success_token || params.success_token;
    const remixstlid = reqBody.remixstlid || params.remixstlid;

    if (captcha_sid) apiParams.set("captcha_sid", captcha_sid);
    if (captcha_key) apiParams.set("captcha_key", captcha_key);
    if (success_token) apiParams.set("success_token", success_token);
    if (remixstlid) apiParams.set("remixstlid", remixstlid);

    try {
        const res = await axios.post(`https://api.vk.com/method/${method}`, apiParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        if (res.data.error) {
            if (res.data.error.error_code === 14) {
                throw { type: "captcha", ...res.data.error };
            }
            throw new Error(res.data.error.error_msg || JSON.stringify(res.data.error));
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
        
        const uploadUrl = req.body.upload_url;
        if (!uploadUrl) throw new Error("Клиент не передал upload_url");
        
        const form = new FormData();
        form.append("file", fs.createReadStream(req.file.path), { filename: "file" + path.extname(req.file.originalname) });
        
        const uploadRes = await axios.post(uploadUrl, form, { 
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });
        
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (!uploadRes.data || !uploadRes.data.file) throw new Error("ВК отклонил файл.");

        res.json({ success: true, file: uploadRes.data.file });
    } catch (e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
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
app.listen(PORT, () => console.log(`🚀 API Server running on port ${PORT}`));