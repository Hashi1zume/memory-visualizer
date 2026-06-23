# Memory Visualizer

Python 3.11 / C / C++ のコードを実行し、変数・メモリ・参照関係・値の遷移をブラウザで可視化するツール。

## このリポジトリでできること

- Python 3.11 / C / C++ のコードをブラウザから実行する。
- 実行ステップを `Prev` / `Next` で1つずつ確認する。
- 現在実行中のコード行を矢印で確認する。
- 変数の値と、前ステップからの変化を見る。
- Pythonのオブジェクト参照やC/C++のポインタ参照を矢印で見る。
- メモリブロックの生成・変更・解放を確認する。
- 標準出力、標準エラー、C/C++のコンパイルエラーを確認する。

## 起動

```bash
npm run dev
```

ブラウザで開く。

```text
http://127.0.0.1:4173
```

## アクセスできない場合

まず疎通確認。

```bash
curl -I http://127.0.0.1:4173
```

`Could not connect` や `Failed to connect` が出る場合は、サーバーが起動していない。

```bash
npm run dev
```

別ターミナルで再確認。

```bash
curl -I http://127.0.0.1:4173
```

`HTTP/1.1 200 OK` が返れば起動済み。

画面が古い場合はブラウザをリロードする。

## 使い方

1. 言語を選択する。
2. コードを直接入力するか、`.py` / `.c` / `.cpp` / `.cc` / `.cxx` を添付する。
3. `実行して可視化` を押す。
4. `Prev` / `Next` で1ステップずつ確認する。
5. `First` / `Last` で先頭・末尾へ移動する。

## 表示内容

- `Code`: 実行中の行を矢印で表示
- `Stack / Heap`: 変数、オブジェクト、メモリブロック、参照矢印
- `Value Changes`: 変数に格納された値の変化
- `Memory Changes`: メモリブロックの生成・変更・解放
- `Output`: 標準出力、標準エラー、コンパイルエラー

## 各値の意味

### Step

- `1 / 10 steps`: 現在のステップ番号 / 総ステップ数
- `First`: 先頭ステップへ移動
- `Prev`: 1ステップ戻る
- `Next`: 1ステップ進む
- `Last`: 最終ステップへ移動
- `L<number>`: 現在実行中のソース行

### Code

- `➜`: 次に確認している実行行
- 行番号: ソースコード上の行
- 黄色の行: 現在のステップに対応する行

### Stack / Heap

- `Variables`: 現在見えている変数一覧
- `Memory`: 変数が参照しているオブジェクトやメモリブロック
- 矢印: 変数から参照先メモリへの関係
- 薄い矢印: 通常の参照
- 濃い矢印: 選択中、ホバー中、または値が変化した変数の参照
- `scalar`: 数値や文字列など、直接値を持つ変数
- `reference`: Pythonのオブジェクト参照
- `pointer`: C/C++のポインタ
- `live`: 有効なメモリ
- `freed`: 解放済みメモリ

### Value Changes

- `new`: そのステップで新しく見えるようになった変数
- `changed`: 前ステップから値が変わった変数
- `removed`: 前ステップにはあったが現在ステップでは見えない変数
- 左の値: 変更前
- 右の値: 変更後

### Memory Changes

- `new`: 新しく作られたオブジェクトまたはメモリブロック
- `changed`: 中身、サイズ、状態が変わったメモリブロック
- `removed`: 前ステップにはあったが現在ステップでは見えないメモリブロック
- `B`: バイト数

### Output

- `stdout`: `print` / `printf` / `cout` などの標準出力
- `stderr`: 実行時エラーや診断情報
- `compile`: C/C++のコンパイルエラー

## 管理コマンド

テスト実行。

```bash
npm test
```

Node構文チェック。

```bash
node --check src/app.js
node --check server.mjs
```

Pythonトレーサの構文チェック。

```bash
python3.11 -m py_compile tools/python_tracer.py
```

## 主要ファイル

- `server.mjs`: 静的配信、実行API、C/C++コンパイル実行
- `tools/python_tracer.py`: Python 3.11 の実行トレース取得
- `src/app.js`: UIとステップ操作
- `src/stateDiff.js`: 値とメモリの差分計算
- `src/traceEngine.js`: デモ用トレース生成
- `src/styles.css`: 画面レイアウト

## 注意

- 実行サーバーはローカル開発用。
- 任意コードを実行するため、公開サーバーとして使わない。
- C/C++ は `gcc` / `g++` が必要。
- Python は `python3.11` が必要。
