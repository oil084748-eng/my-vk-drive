import React, { useState, useEffect } from "react";
import axios from "axios";

const API = "http://localhost:3000";

export default function App() {
  const [files, setFiles] = useState([]);
  const [path, setPath] = useState("");
  const [folder, setFolder] = useState("");

  useEffect(() => {
    load();
  }, [path]);

  const load = async () => {
    const res = await axios.get(API + "/files", {
      params: { folder_path: path },
    });
    setFiles(res.data);
  };

  const upload = async (e) => {
    const form = new FormData();
    form.append("file", e.target.files[0]);
    form.append("folder_path", path);

    await axios.post(API + "/upload", form);
    load();
  };

  const createFolder = () => {
    if (!folder) return;
    setPath(path + "/" + folder);
    setFolder("");
  };

  const back = () => {
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    setPath("/" + parts.join("/"));
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Cloud Drive</h2>

      <input
        placeholder="Новая папка"
        value={folder}
        onChange={(e) => setFolder(e.target.value)}
      />
      <button onClick={createFolder}>Создать</button>

      <input type="file" onChange={upload} />

      <button onClick={back}>Назад</button>

      <p>Путь: {path || "/"}</p>

      <ul>
        {[...new Set(files.map(f => f.title.split("/")[1]).filter(Boolean))].map(f => (
          <li key={f} onClick={() => setPath(path + "/" + f)}>
            📁 {f}
          </li>
        ))}
      </ul>

      <ul>
        {files.map(f => (
          <li key={f.id}>
            📄 {f.title.split("/").pop()}
            <a href={f.url}> скачать</a>
          </li>
        ))}
      </ul>
    </div>
  );
}