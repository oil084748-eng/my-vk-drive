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

const VK_TOKEN = "vk1.a.9IWAg6xUmeHq-2qOjlrAG2nNpYS4s0GYkUrKu8lMwXmrhUSgQnpgdj0cmZrRS13ZwtenBW3dPGW2xZtlpkWchwprwx9rTK1LM0jRpkWd6Xs6eGQgOPJPDfyydEFCiI1vSUXW8JMsk-tDk6h3ujaB8uAdRoXae0seS9CUM6EI53b3ILCTytawu-bJC92CuGWN7hcA3z4rmPUU7nmk02yQcg";
const GROUP_ID = "236017708"; 

const upload = multer({ dest: "uploads/" });

// Вспомогательная функция для пауз (миллисекунды)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// УМНАЯ ФУНКЦИЯ ЗАПРОСОВ С ПОВТОРАМИ
async function requestWithRetry(config, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios(config);
            // ВК может вернуть 200 OK, но внутри будет объект error
            if (response.data && response.data.error) {
                const errorCode = response.data.error.error_code;
                // Ошибка 6 - слишком много запросов в секунду
                if (errorCode === 6 && i < retries - 1) {
                    await delay(1000); // Ждем секунду и пробуем снова
                    continue;
                }
                // Ошибка 14 - капча (её мы прокидываем на клиент)
                if (errorCode === 14) return response; 
            }
            return response;
        } catch (error) {
            if (i === retries - 1) throw error;
            await delay(1000);
        }
    }
}

app.get("/files", async (req, res) => {
    try {
        const response = await requestWithRetry({
            method: 'get',
            url: "https://api.vk.com/method/docs.get",
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

        const serverRes = await requestWithRetry({ method: 'get', url: serverUrl });
        if (serverRes.data.error && serverRes.data.error.error_code === 14) return res.status(403).json(serverRes.data.error);

        const form = new FormData();
        form.append("file", fs.createReadStream(req.file.path), { filename: originalName });
        
        // Загрузка файла на сервер ВК (обычно не требует повторов, так как это pu.vk.ru)
        const uploadRes = await axios.post(serverRes.data.response.upload_url, form, { headers: form.getHeaders() });

        const saveRes = await requestWithRetry({
            method: 'post',
            url: "https://api.vk.com/method/docs.save",
            data: `file=${uploadRes.data.file}&title=${encodeURIComponent(finalTitle)}&access_token=${VK_TOKEN}&v=5.131`,
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json(saveRes.data.response);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/move", async (req, res) => {
    try {
        for (let item of req.body.items) {
            await requestWithRetry({
                method: 'get',
                url: "https://api.vk.com/method/docs.edit",
                params: { owner_id: -GROUP_ID, doc_id: item.id, title: item.new_title, access_token: VK_TOKEN, v: "5.131" }
            });
            // Небольшая пауза между файлами в цикле, чтобы не злить ВК
            await delay(200); 
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/delete", async (req, res) => {
    try {
        await requestWithRetry({
            method: 'get',
            url: "https://api.vk.com/method/docs.delete",
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

app.listen(3000, () => console.log("Сервер с защитой от перегрузок запущен"));