"use strict";
/* colheita demo: descarrega as imagens dos posts @david.f.marques e cria as entradas do feed */
const db = require("./src/db");
const fs = require("fs");
const path = require("path");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/* ordem: inserimos do mais antigo para o mais recente — o feed (ORDER BY id DESC LIMIT 6)
   mostra então o post mais recente primeiro, tal como a grelha do Instagram */
const items = [
  ["DPZjU2Yjelv", "Zine workshop @zumbidobooks"],
  ["DQfW4Y8jQo5", ""],
  ["DRXYB3XjUyJ", ""],
  ["DVo5DduDcKg", ""],
  ["DWML9BCjXpx", ""],
  ["DYfj2E3xgmc", ""],
  ["DYrs_KrNz3V", ""],
  ["DZdkOqJN27-", ""],
  ["DaQpbRsO0vF", ""],
  ["DboXPFexyIU", ""],
];

const imgs = {
  DPZjU2Yjelv: "https://instagram.flis12-1.fna.fbcdn.net/v/t51.82787-15/558938416_18205230307309760_3286878130526144599_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=100&_nc_map=urlgen_bucketless&ig_cache_key=MzczNjE3MjczMDI5MTk3MjQ2Mw%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=3PZy4AykrHAQ7kNvwF3I5_r&_nc_oc=AdqJSB6PRodO11Y3jZgdLIMS-lbmuSxfHjahItPs8jlKqb_LNn1WayFGIbmEZH0Wkv78i0vSYklnaSIKxkiRPKGI&_nc_zt=23&_nc_ht=instagram.flis12-1.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQPpXxPaKM4T07dbf8AUY3jcDYxIs749flinBT4WwGtaDg&oe=6AE00CD6",
  DQfW4Y8jQo5: "https://instagram.flis8-2.fna.fbcdn.net/v/t51.82787-15/572980898_18209311321309760_5136578483851198950_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=103&_nc_map=urlgen_bucketless&ig_cache_key=Mzc1NTgyMTI0NjM0OTkwNDQ0MQ%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTA4MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=ArPOOJoFktsQ7kNvwH96NFp&_nc_oc=Adp1-h02HW5uQQuWPcyNrzSvgfQ1nvCYqFHF3ONUDA1FHPCjA2xxu8LXHnWAVcsnsPKadNRyik1URToVHs4ygvwq&_nc_zt=23&_nc_ht=instagram.flis8-2.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQPJCLiR5wO28AMgyOYwmpGa-8NOgErwJGcGG2ORuC8CNQ&oe=6AE00D27",
  DRXYB3XjUyJ: "https://instagram.flis12-1.fna.fbcdn.net/v/t51.82787-15/587298259_18211674040309760_2980544321863332386_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=110&_nc_map=urlgen_bucketless&ig_cache_key=Mzc3MTU4ODg5NDIzMjc1OTQzMw%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=z5e4XnpsbAYQ7kNvwHtMqbB&_nc_oc=Adpwk5K2UC9ztXose9mTv_20B4nyJEr5DuDeRmbFKcqrUAX2OqHTvxN1r6C8TO1HBTZHw7A_nTXFuEQABZDB9IDX&_nc_zt=23&_nc_ht=instagram.flis12-1.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQO15RSJPalKveT6vXYxkwBO4oONkm4IurxJrf3Qk0b2Xw&oe=6ADFDFB4",
  DVo5DduDcKg: "https://instagram.flis12-1.fna.fbcdn.net/v/t51.82787-15/649665941_18222830842309760_3057353873732089979_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=109&_nc_map=urlgen_bucketless&ig_cache_key=Mzg0ODU3NjQxMzk5MzkxMzA3MA%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkNBUk9VU0VMX0lURU0ueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=8y1fhJOe-h8Q7kNvwEOiBuL&_nc_oc=AdrjwkYPrVrwZk6xqYxAgcHVXuF5B1P6T9bnquz0HbzZWP99vUmYyaSNCj3GJRoAmeZTM0ZkiweqMJZtTXGpQZzv&_nc_zt=23&_nc_ht=instagram.flis12-1.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQMUufTdvXoKrkaUaXlEe7VtJ5MxrKyf403mLOo_aBIMVg&oe=6ADFE29F",
  DWML9BCjXpx: "https://instagram.flis8-2.fna.fbcdn.net/v/t51.82787-15/655726096_18224948113309760_7886567409356065196_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=109&_nc_map=urlgen_bucketless&ig_cache_key=Mzg1ODUxMTU1MjI2NTk0MzY2NQ%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=DlKRZ6UfkzsQ7kNvwG1VVPL&_nc_oc=Adprm4AxLKH1_5s3i1dks63AwGhdiMMERCNUDw5VP-s9wuoNNWmskCj6vZ9P9sSfJRXOAGDqdNjPFy7cU4m9nmZJ&_nc_zt=23&_nc_ht=instagram.flis8-2.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQO9-4yrnJkdlaxFqV7FqNWpIQkmtS9_jnWYqdeOoKu48Q&oe=6AE000D6",
  DYfj2E3xgmc: "https://instagram.flis12-1.fna.fbcdn.net/v/t51.82787-15/702343004_18231411868309760_7782851090783805753_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=100&_nc_map=urlgen_bucketless&ig_cache_key=Mzg5OTk5MzQ1MDAzNjQ2NDAyOA%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=zb32LrOp4-QQ7kNvwG1ewJ3&_nc_oc=Adp4_nPezoe5a951eWt-0NrO7sFMPrEAlin1qctTGMg3lCJLUv6lZQnZpZYBrFcHJvBMeM_GyrjjxNUpw0pC8JzP&_nc_zt=23&_nc_ht=instagram.flis12-1.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQOOARvIIVwbal_fjBd9Nw4SUb75SP_WCsedH2sCOYBbcg&oe=6AE00774",
  DYrs_KrNz3V: "https://instagram.flis12-2.fna.fbcdn.net/v/t51.82787-15/706496165_18231936376309760_8055881969175332721_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=111&_nc_map=urlgen_bucketless&ig_cache_key=MzkwMzQxMTM1Njg4MjY0ODUzMw%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=FoK14zdmJ-kQ7kNvwEoaxLC&_nc_oc=AdpoUvGzxBSpRVUIUC5G9-UbZqzVgZyrfYema1s3ymPTzybb6CwGUd8RZjA2z-VZ1FhuPzIc_XtetC-licRwK7MN&_nc_zt=23&_nc_ht=instagram.flis12-2.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQMf_7NDEec_MCdmz3yN24F_rKv9SwEyGt7Ygc2U1KjVFw&oe=6ADFE643",
  "DZdkOqJN27-": "https://instagram.flis12-2.fna.fbcdn.net/v/t51.82787-15/721625990_18234204973309760_8716356488220417811_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=101&_nc_map=urlgen_bucketless&ig_cache_key=MzkxNzQ0NjU4Nzg4MTA1ODA0Ng%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=w1ij22ICK4AQ7kNvwFTI22C&_nc_oc=AdrRY2RKROYaMEVIlmf1A4FbRg65AGe6b09iH_dW4o0kvYc0Ix925aHDjZQjUMpNn1GxTCuXBlJpzqk-NX8wgjQo&_nc_zt=23&_nc_ht=instagram.flis12-2.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQNtzWBHybGCr29rqBTjUzRn2qpb164vQZoAadYYNFDXyA&oe=6AE00D40",
  DaQpbRsO0vF: "https://instagram.flis8-1.fna.fbcdn.net/v/t51.82787-15/730853903_18236527678309760_7681881873820656182_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=111&_nc_map=urlgen_bucketless&ig_cache_key=MzkzMTgyNDY2OTAyMjk2NDY3Nw%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=NsMbfdlWmYQQ7kNvwFh5Etk&_nc_oc=AdrerLDcytkYXcBRf9TjDL5rXjBYzmHEsyCakweILouGrbvxeGTVJ8BJiGhwpV2ElriDvqU03EwfbYUCLXDom6m-&_nc_zt=23&_nc_ht=instagram.flis8-1.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQMq60OlZh5BzV2_wFrzT5KdTRQHwx5zR4_ioOKIbygk7A&oe=6ADFED05",
  DboXPFexyIU: "https://instagram.flis12-1.fna.fbcdn.net/v/t51.82787-15/765187877_18240557419309760_8966097420036174468_n.heic?stp=dst-jpg_e35_tt6&_nc_cat=111&_nc_map=urlgen_bucketless&ig_cache_key=Mzk1NjUxNDQ2NDM5MTk2MzE1Ng%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=7nYVkDQKHpcQ7kNvwFseFQa&_nc_oc=AdpNZvCEKk3N36w9ECoWFHLMZIjE0RLIMitkKupNYKyqqd62H0BH2Zi27XDgtvLn1Coc0-dH4RD759Yy8pfPD4dL&_nc_zt=23&_nc_ht=instagram.flis12-1.fna&_nc_gid=8kCT7tftoV1MDBpe3JDfrQ&_nc_ss=786a8&oh=00_AQOljRLnppaLvGV3y-tpeXIwBOInTNAx_ia_QIclXWnt1A&oe=6AE00420",
};

(async () => {
  const dir = path.join(__dirname, "public/img/feed");
  fs.mkdirSync(dir, { recursive: true });
  // limpar entradas de teste/colheitas anteriores
  db.db.prepare("DELETE FROM news WHERE caption = 'post demo 1'").run();
  db.db.prepare("DELETE FROM news WHERE caption LIKE '%workshop @zumbidobooks'").run();

  let made = 0;
  for (const [shortcode, cap] of items) {
    try {
      const r = await fetch(imgs[shortcode], {
        headers: { "user-agent": UA, referer: "https://www.instagram.com/", accept: "*/*" },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) { console.log(shortcode, "GET falhou", r.status); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) { console.log(shortcode, "resposta suspeita", buf.length, "bytes"); continue; }
      const ctype = r.headers.get("content-type") || "";
      const nome = `feed-${shortcode}.${ctype.includes("webp") ? "webp" : "jpg"}`;
      fs.writeFileSync(path.join(dir, nome), buf);
      db.db.prepare("INSERT INTO news (kind, caption, image_url, published, created_at) VALUES ('manual', ?, ?, 1, ?)")
        .run(cap || "", "/img/feed/" + nome, new Date().toISOString());
      console.log(shortcode, "->", nome, Math.round(buf.length / 1024) + "kB", cap ? "(«" + cap + "»)" : "");
      made++;
    } catch (e) {
      console.log(shortcode, "ERRO", e.message.slice(0, 60));
    }
  }
  console.log("entradas criadas:", made);
  console.log("feed home (ordem na linha):", db.db.prepare("SELECT image_url, caption FROM news WHERE kind='manual' AND published=1 AND image_url<>'' ORDER BY id DESC LIMIT 6").all().map((f) => path.basename(f.image_url) + (f.caption ? " («" + f.caption + "»)" : "")));
  process.exit(0);
})();
