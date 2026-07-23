// ==UserScript==
// @name         リベシティ ovice スタンプパレット
// @namespace    https://libecity.com/
// @version      1.5.0
// @description  oviceでスタンプをたくさん使えるパレット。ドラッグで移動、サイズ・効果音の選択、スタンプの追加/削除に対応。
// @match        https://app.ovice.com/*
// @match        https://*.ovice.in/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ページのwindow(ovice API)に触るため、pageコンテキストへ本体を注入する
  const source = function () {
    const PALETTE_VERSION = 'v12';
    const STORE_KEY = 'libecity-stamp-palette';

    // ── デフォルトのスタンプ（画像URLは公開されているものを利用） ──
    const GH = 'https://raw.githubusercontent.com/snst-lab/chrome-extensions/main/ovice-helper/image/';
    const OV = 'https://assets.ovice.io/upload/custom_reactions/';
    const DEFAULT_STAMPS = [
      GH + 'Clap.png', GH + 'Hand.png', GH + 'Good.png', GH + 'Drum.png',
      GH + 'Love.png', GH + 'Nope.png', GH + 'Tada.png', GH + 'Exclamation.gif',
      GH + 'Question.png', GH + 'Sweat.gif', GH + 'Kusa.gif',
      OV + '6db684ef-1c0a-4c4d-9456-35055249c049.gif',
      OV + 'a9d5a315-9af2-4d06-8cab-0eea0bf50a45.gif',
      OV + 'cb418ef9-26da-413d-88d9-d009acd8bb5a.png',
      OV + '92ef8e78-32c6-49d9-a3dc-af35c4f0f60d.gif',
      OV + '11edd89a-be01-42ef-8daf-395e61851568.png',
    ];

    // 音の選択肢: 表示名 / data-emoji-code（oviceが受信側で効果音を鳴らすコード）
    // 注: oviceの内部対応表では複数の絵文字が同じ音を共有しているため、
    //     実際に鳴り分けられる音だけを選択肢にしている
    const SOUNDS = [
      { key: '',      label: 'なし',      code: '' }, // 実際のコードは起動時にno_soundリアクションから取得
      { key: 'clap',  label: '拍手',      code: '1F44F' },
      { key: 'pachin',label: 'パチン',    code: '270B' },
      { key: 'drum',  label: 'ドラム',    code: '1F941' },
      { key: 'love',  label: 'ラブ',      code: '2764-FE0F' },
      { key: 'haha',  label: '笑',        code: '1F602' },
      { key: 'nope',  label: 'ブッブー',  code: '274C' },
      { key: 'tada',  label: 'ジャーン',  code: '1F389' },
      { key: 'down',  label: 'しょんぼり', code: '1F61E' },
      { key: 'surprised', label: '！',    code: '2757' },
      { key: 'question',  label: '？',    code: '2753' },
      { key: 'wait',  label: 'チーン',    code: '23F3' },
      { key: 'hi5',   label: 'ハイタッチ', code: '' }, // for="hi5" の文字列検知で鳴る特殊枠
    ];

    // 「なし」で通知音すら鳴らさないために、スペースに登録されている
    // 無音カスタムリアクション(sound: no_sound)のコードを探して使う
    let SILENT_CODE = '';
    fetch('https://api.ovice.com/api/v4/users/settings/reactions', { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        const silent = (j.data || []).find(x => x.sound === 'no_sound');
        if (silent) SILENT_CODE = silent.id;
      })
      .catch(() => {});
    // 特大・巨大はovice-helperの画像送信サイズ(中120/大240)に相当
    const SIZES = [
      { key: 'S',   label: '小',   px: 24 },
      { key: 'M',   label: '中',   px: 40 },
      { key: 'L',   label: '大',   px: 64 },
      { key: 'XL',  label: '特大', px: 120 },
      { key: 'XXL', label: '巨大', px: 240 },
    ];

    // ── 設定はlocalStorage、スタンプ本体は容量の大きいIndexedDBに保存 ──
    const state = Object.assign(
      { stamps: null, size: 'S', sound: '', open: true, x: 20, y: 60, editing: false },
      loadSettings()
    );

    // 旧バージョンの音設定(good/hand等)が残っていたら「なし」に戻す
    if (!SOUNDS.some(s => s.key === state.sound)) state.sound = '';

    function loadSettings() {
      try {
        const s = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
        return { size: s.size, sound: s.sound, open: s.open, x: s.x, y: s.y, legacyStamps: s.stamps };
      } catch (e) { return {}; }
    }
    function saveSettings() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          size: state.size, sound: state.sound, open: state.open, x: state.x, y: state.y,
        }));
      } catch (e) { /* ignore */ }
    }

    function idb() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('libecity-stamp-palette', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    async function idbGet(key) {
      const db = await idb();
      return new Promise((res, rej) => {
        const t = db.transaction('kv').objectStore('kv').get(key);
        t.onsuccess = () => res(t.result);
        t.onerror = () => rej(t.error);
      });
    }
    async function idbSet(key, val) {
      const db = await idb();
      return new Promise((res, rej) => {
        const t = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
        t.onsuccess = () => res();
        t.onerror = () => rej(t.error);
      });
    }
    // 旧形式(URL文字列の配列)を新形式({url, size}の配列)に変換する
    const normalizeStamps = arr => arr.map(s => (typeof s === 'string' ? { url: s, size: null } : s));
    async function loadStamps() {
      try {
        const saved = await idbGet('stamps');
        if (saved && saved.length) return normalizeStamps(saved);
      } catch (e) { /* fall through */ }
      // 旧バージョン(localStorage保存)からの引き継ぎ
      if (state.legacyStamps && state.legacyStamps.length) return normalizeStamps(state.legacyStamps);
      return normalizeStamps(DEFAULT_STAMPS);
    }
    function saveStamps() {
      idbSet('stamps', state.stamps).catch(() => alert('スタンプの保存に失敗しました'));
    }

    // oviceは受信メッセージの生文字列を部分一致で走査し、'hi5'を含むと
    // ハイタッチ音を鳴らす。base64画像データに偶然'hi5'が含まれると誤爆するため、
    // 'h'をHTML実体参照(&#104;)に置き換えて回避する。HTML属性値として解釈される
    // 時点で元の文字列に戻るので、画像の表示結果は一切変わらない
    function safeSrc(url) {
      return url.replace(/hi5/g, '&#104;i5');
    }

    // ── スタンプ送信（ovice-helperと同じ仕組み: ovice.chat + commitReaction） ──
    function sendStamp(stamp) {
      if (!window.ovice || typeof window.ovice.chat !== 'function') {
        alert('oviceの読み込みが完了していません。少し待ってから試してください。');
        return;
      }
      // スタンプ個別の音設定があれば全体設定より優先する（null/未設定=全体に従う）
      const soundKey = stamp.sound ?? state.sound;
      const sound = SOUNDS.find(s => s.key === soundKey) || SOUNDS[0];
      // スタンプ個別のサイズ設定があれば全体設定より優先する
      const px = (SIZES.find(s => s.key === (stamp.size || state.size)) || SIZES[0]).px;
      // ハイタッチは絵文字コードでは鳴らせないため無音コードにし、for="hi5"の文字列検知で鳴らす
      const code = (sound.key === '' || sound.key === 'hi5') ? SILENT_CODE : sound.code;
      const forAttr = sound.key ? ` for="${sound.key}"` : '';
      const msg =
        `<span${forAttr} data-emoji-code="${code}" class="break-space">` +
        `<img width="40" height="auto" style="width:${px}px;height:auto;" src="${safeSrc(stamp.url)}" /></span>`;
      // oviceは入室完了前だとエラーも出さず送信を無視するため、先に確認する
      if (!window.ovice.userId_) {
        alert('oviceへの入室がまだ完了していないようです。\n自分のアバターがスペース内に表示されてから、もう一度お試しください');
        return;
      }
      try {
        window.ovice.chat(msg);
        window.ovice.commitReaction();
      } catch (err) {
        alert('スタンプの送信でエラーが発生しました：' + err.message);
      }
    }

    // ── スタイル ──
    const css = `
      #lsp-panel { position: fixed; z-index: 9999; background: #fff; border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,.25); width: 560px; max-width: 92vw;
        font-family: 'Noto Sans JP', sans-serif; user-select: none; }
      #lsp-header { background: #ffe3d5; border-radius: 12px 12px 0 0; padding: 8px 12px;
        font-size: 13px; font-weight: bold; color: #7c4a2d; cursor: grab;
        display: flex; justify-content: space-between; align-items: center; }
      #lsp-header:active { cursor: grabbing; }
      #lsp-close { cursor: pointer; border: none; background: none; font-size: 16px; color: #b06a45; }
      #lsp-options { display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
        padding: 8px 12px 0; font-size: 12px; color: #555; }
      .lsp-chip { border: 1px solid #ddd; border-radius: 14px; padding: 3px 10px; cursor: pointer;
        background: #fff; font-size: 12px; }
      .lsp-chip.lsp-on { background: #ff7043; color: #fff; border-color: #ff7043; }
      #lsp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; padding: 12px;
        max-height: 320px; overflow-y: auto; }
      .lsp-stamp { position: relative; border: 1px solid #eee; border-radius: 10px; background: #fff;
        cursor: pointer; padding: 4px; height: 64px; display: flex; align-items: center; justify-content: center; }
      .lsp-stamp:hover { box-shadow: 0 2px 8px rgba(0,0,0,.2); }
      .lsp-stamp img { max-width: 100%; max-height: 100%; pointer-events: none; }
      .lsp-stamp .lsp-del { display: none; position: absolute; top: -6px; right: -6px; width: 18px; height: 18px;
        border-radius: 50%; background: #e53935; color: #fff; font-size: 12px; line-height: 18px; text-align: center; }
      #lsp-panel.lsp-editing .lsp-del { display: block; }
      .lsp-size-badge { display: none; position: absolute; bottom: -6px; right: -6px; background: #607d8b;
        color: #fff; border-radius: 8px; font-size: 10px; line-height: 1; padding: 3px 6px; pointer-events: none; }
      .lsp-stamp .lsp-size-badge.lsp-set { display: block; }
      #lsp-panel.lsp-editing .lsp-size-badge { display: block; pointer-events: auto; cursor: pointer; }
      .lsp-sound-badge { display: none; position: absolute; bottom: -6px; left: -6px; background: #8e24aa;
        color: #fff; border-radius: 8px; font-size: 10px; line-height: 1; padding: 3px 6px; pointer-events: none; }
      .lsp-stamp .lsp-sound-badge.lsp-set { display: block; }
      #lsp-panel.lsp-editing .lsp-sound-badge { display: block; pointer-events: auto; cursor: pointer; }
      .lsp-stamp.lsp-dragover { outline: 2px dashed #ff7043; }
      #lsp-footer { display: flex; gap: 8px; padding: 0 12px 12px; }
      .lsp-btn { border: 1px solid #ddd; border-radius: 8px; background: #fafafa; cursor: pointer;
        font-size: 12px; padding: 4px 10px; color: #555; }
      #lsp-toggle { position: fixed; right: 24px; bottom: 96px; z-index: 9999; width: 48px; height: 48px;
        border-radius: 50%; border: none; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.3);
        font-size: 24px; cursor: pointer; }
    `;

    // ── UI構築 ──
    function build() {
      if (document.getElementById('lsp-panel')) return;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);

      const toggle = document.createElement('button');
      toggle.id = 'lsp-toggle';
      toggle.textContent = '🎨';
      toggle.title = 'スタンプパレットを開く/閉じる';
      document.body.appendChild(toggle);

      const panel = document.createElement('div');
      panel.id = 'lsp-panel';
      panel.style.left = state.x + 'px';
      panel.style.top = state.y + 'px';
      panel.style.display = state.open ? 'block' : 'none';
      panel.innerHTML = `
        <div id="lsp-header"><span>🎨 スタンプ ${PALETTE_VERSION}（ここをドラッグで移動）</span>
          <button id="lsp-close" title="閉じる">✕</button></div>
        <div id="lsp-options"></div>
        <div id="lsp-grid"></div>
        <div id="lsp-footer">
          <button class="lsp-btn" id="lsp-add-file">＋画像ファイル</button>
          <button class="lsp-btn" id="lsp-paste">📋 コピーした画像を貼り付け</button>
          <button class="lsp-btn" id="lsp-add-url">＋URL</button>
          <button class="lsp-btn" id="lsp-edit" title="スタンプの削除と、1個ずつの大きさ設定ができます">✏️ 編集モード</button>
          <input id="lsp-file" type="file" accept="image/*" style="display:none">
        </div>`;
      document.body.appendChild(panel);

      toggle.addEventListener('click', () => {
        state.open = !state.open;
        panel.style.display = state.open ? 'block' : 'none';
        saveSettings();
      });
      panel.querySelector('#lsp-close').addEventListener('click', () => {
        state.open = false; panel.style.display = 'none'; saveSettings();
      });

      renderOptions(panel);
      loadStamps().then(stamps => {
        state.stamps = stamps;
        renderGrid(panel);
      });
      enableDrag(panel);

      const addStamp = url => {
        if (!state.stamps) {
          alert('スタンプ一覧を読み込み中です。1〜2秒待ってからもう一度お試しください');
          return;
        }
        state.stamps.push({ url: url, size: null }); saveStamps(); renderGrid(panel);
      };

      const addImageBlob = blob => {
        if (!blob || !/image/.test(blob.type)) { alert('画像ファイルではないようです'); return; }
        const reader = new FileReader();
        reader.onload = ev => {
          const dataUrl = ev.target.result;
          // アニメGIFはcanvas縮小するとアニメが失われるため、そのまま登録（1MBまで）
          if (blob.type === 'image/gif') {
            if (blob.size > 1024 * 1024) {
              alert('アニメGIFは1MB以下にしてください。\nezgif.com などで幅240px程度に縮小すると軽くなります。\n（静止画 png/jpg なら大きくても自動で縮小されます）');
              return;
            }
            addStamp(dataUrl);
            return;
          }
          // 静止画はスタンプ表示サイズに合わせて自動縮小（透過を保ったままPNG化）
          const img = new Image();
          img.onload = () => {
            const MAX = 256;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            let out = canvas.toDataURL('image/png');
            if (out.length > 400 * 1024) out = canvas.toDataURL('image/webp', 0.85);
            addStamp(out);
          };
          img.onerror = () => alert('画像を読み込めませんでした（対応していない形式かもしれません）');
          img.src = dataUrl;
        };
        reader.readAsDataURL(blob);
      };

      panel.querySelector('#lsp-add-url').addEventListener('click', () => {
        const url = prompt('スタンプ画像のURLを入力してください（png / gif など）');
        if (!url) return;
        const u = url.trim();
        if (/^(https?:\/\/|data:image)/.test(u)) {
          addStamp(u);
        } else {
          alert('https:// で始まる「画像への直リンク」を入れてください。\nWebページ上の画像なら、画像を右クリック→「画像アドレスをコピー」で取得できます。\nコピーした画像は「📋 コピーした画像を貼り付け」ボタンでも追加できます。');
        }
      });
      const fileInput = panel.querySelector('#lsp-file');
      panel.querySelector('#lsp-add-file').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', e => {
        if (e.target.files[0]) addImageBlob(e.target.files[0]);
        fileInput.value = '';
      });
      // コピーした画像（右クリック→「画像をコピー」やスクショ）を貼り付けで追加
      panel.querySelector('#lsp-paste').addEventListener('click', async () => {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const type = item.types.find(t => t.startsWith('image/'));
            if (type) { addImageBlob(await item.getType(type)); return; }
          }
          alert('クリップボードに画像が見つかりません。\n画像を右クリック→「画像をコピー」してからもう一度押してください');
        } catch (err) {
          alert('クリップボードを読み取れませんでした。\nブラウザの許可ダイアログが出た場合は「許可」を選んでください');
        }
      });
      // 画像ファイルや他ページの画像をパネルへドラッグ＆ドロップでも追加できる
      panel.addEventListener('dragover', e => e.preventDefault());
      panel.addEventListener('drop', e => {
        // スタンプの並べ替えドラッグは各スタンプ側で処理するのでここでは無視
        if ([...e.dataTransfer.types].includes('text/lsp-index')) return;
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) { addImageBlob(e.dataTransfer.files[0]); return; }
        const uri = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).trim().split('\n')[0];
        if (/^(https?:\/\/|data:image)/.test(uri)) addStamp(uri);
      });
      panel.querySelector('#lsp-edit').addEventListener('click', () => {
        state.editing = !state.editing;
        panel.classList.toggle('lsp-editing', state.editing);
      });
    }

    function renderOptions(panel) {
      const box = panel.querySelector('#lsp-options');
      box.innerHTML = '';
      const addChips = (title, items, get, set) => {
        const label = document.createElement('span');
        label.textContent = title;
        box.appendChild(label);
        items.forEach(it => {
          const chip = document.createElement('button');
          chip.className = 'lsp-chip' + (get() === it.key ? ' lsp-on' : '');
          chip.textContent = it.label;
          chip.addEventListener('click', () => { set(it.key); saveSettings(); renderOptions(panel); });
          box.appendChild(chip);
        });
      };
      addChips('大きさ', SIZES, () => state.size, v => (state.size = v));
      addChips('　音', SOUNDS, () => state.sound, v => (state.sound = v));
    }

    const SIZE_CYCLE = [null].concat(SIZES.map(s => s.key));
    const sizeLabel = s => (s === null ? '標準' : (SIZES.find(x => x.key === s) || SIZES[0]).label);
    const soundLabel = s => (s == null ? '標準' : (SOUNDS.find(x => x.key === s) || SOUNDS[0]).label);

    function renderGrid(panel) {
      const grid = panel.querySelector('#lsp-grid');
      grid.innerHTML = '';
      (state.stamps || []).forEach((stamp, i) => {
        const cell = document.createElement('button');
        cell.className = 'lsp-stamp';
        cell.draggable = true;
        cell.innerHTML =
          `<img src="${stamp.url}">` +
          `<span class="lsp-del" title="削除">✕</span>` +
          `<span class="lsp-size-badge${stamp.size ? ' lsp-set' : ''}" title="クリックで大きさを切替">${sizeLabel(stamp.size)}</span>` +
          `<span class="lsp-sound-badge${stamp.sound != null ? ' lsp-set' : ''}" title="クリックでこのスタンプ専用の音を設定">♪${soundLabel(stamp.sound)}</span>`;
        cell.addEventListener('click', () => { if (!state.editing) sendStamp(stamp); });
        cell.querySelector('.lsp-del').addEventListener('click', e => {
          e.stopPropagation();
          state.stamps.splice(i, 1); saveStamps(); renderGrid(panel);
        });
        // 編集モード中: バッジクリックで 標準→小→中→大→特大→巨大 を巡回
        cell.querySelector('.lsp-size-badge').addEventListener('click', e => {
          e.stopPropagation();
          if (!state.editing) return;
          stamp.size = SIZE_CYCLE[(SIZE_CYCLE.indexOf(stamp.size) + 1) % SIZE_CYCLE.length];
          saveStamps(); renderGrid(panel);
        });
        // 編集モード中: ♪バッジクリックでこのスタンプ専用の音を番号選択
        cell.querySelector('.lsp-sound-badge').addEventListener('click', e => {
          e.stopPropagation();
          if (!state.editing) return;
          const lines = ['0: 標準（全体の音設定に従う）']
            .concat(SOUNDS.map((s, n) => `${n + 1}: ${s.label}`));
          const cur = stamp.sound == null ? 0 : SOUNDS.findIndex(s => s.key === stamp.sound) + 1;
          const ans = prompt('このスタンプ専用の音を番号で入力してください\n' + lines.join('\n'), String(cur));
          if (ans === null) return;
          const n = parseInt(ans, 10);
          if (isNaN(n) || n < 0 || n > SOUNDS.length) { alert('0〜' + SOUNDS.length + 'の番号を入力してください'); return; }
          stamp.sound = n === 0 ? null : SOUNDS[n - 1].key;
          saveStamps(); renderGrid(panel);
        });
        // ドラッグ＆ドロップで並べ替え
        cell.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/lsp-index', String(i));
          e.dataTransfer.effectAllowed = 'move';
        });
        cell.addEventListener('dragover', e => {
          if ([...e.dataTransfer.types].includes('text/lsp-index')) {
            e.preventDefault();
            cell.classList.add('lsp-dragover');
          }
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('lsp-dragover'));
        cell.addEventListener('drop', e => {
          const from = e.dataTransfer.getData('text/lsp-index');
          if (from === '') return;
          e.preventDefault();
          e.stopPropagation();
          const moved = state.stamps.splice(Number(from), 1)[0];
          state.stamps.splice(i, 0, moved);
          saveStamps(); renderGrid(panel);
        });
        grid.appendChild(cell);
      });
    }

    function enableDrag(panel) {
      const header = panel.querySelector('#lsp-header');
      let sx, sy, px, py, dragging = false;
      header.addEventListener('mousedown', e => {
        if (e.target.id === 'lsp-close') return;
        dragging = true; sx = e.clientX; sy = e.clientY;
        px = panel.offsetLeft; py = panel.offsetTop;
        e.preventDefault();
      });
      window.addEventListener('mousemove', e => {
        if (!dragging) return;
        state.x = Math.max(0, px + e.clientX - sx);
        state.y = Math.max(0, py + e.clientY - sy);
        panel.style.left = state.x + 'px';
        panel.style.top = state.y + 'px';
      });
      window.addEventListener('mouseup', () => { if (dragging) { dragging = false; saveSettings(); } });
    }

    // スペース読み込み完了（メニューバー出現）を待って起動。SPA遷移にも追従する
    setInterval(() => {
      if (document.querySelector('[aria-label="status-menu"]') && !document.getElementById('lsp-panel')) {
        build();
      }
    }, 2000);
  };

  const script = document.createElement('script');
  script.textContent = '(' + source.toString() + ')();';
  document.documentElement.appendChild(script);
  script.remove();
})();
