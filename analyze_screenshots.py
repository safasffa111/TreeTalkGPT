import os
import requests
import base64

# ===================== 仅保留智谱配置 =====================
ZHIPU_API_KEY = "d3f4723443a4424897f3af2d19e9b4e3.Hgjsh61VRy9LxZ8Z"
ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
# =================================================================

def encode_image(image_path):
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

# ------------------- 仅保留智谱 -------------------
def analyze_zhipu(image_path):
    try:
        base64_img = encode_image(image_path)
        payload = {
            "model": "glm-4v-flash",
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": "图片是长截图拼接，有重复，请去重后给出所有题目的答案，格式：’1.A 2.B 3.C‘ 在同一行写,不要换行，不要换行，不要换行，严格按照格式，不要多空格和少空格，只返回答案或选项，不要其他内容"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_img}"}}
                ]
            }],
            "temperature": 0.1,
            "stream": False
        }
        headers = {
            "Authorization": f"Bearer {ZHIPU_API_KEY}",
            "Content-Type": "application/json"
        }
        response = requests.post(ZHIPU_API_URL, json=payload, headers=headers)
        return response.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"智谱错误：{e}")
        return None

# ------------------- 答案解析 -------------------
def parse_answer_line(line):
    res = {}
    if not line:
        return res
    parts = line.strip().split()
    for p in parts:
        if "." in p:
            num, ans = p.split(".", 1)
            if num.isdigit():
                res[int(num)] = ans.strip()
    return res

# ------------------- 主程序 -------------------
def main():
    folder = "screenshots"
    answers_folder = "answers"
    os.makedirs(answers_folder, exist_ok=True)
    os.makedirs(folder, exist_ok=True)
    images = [f for f in os.listdir(folder) if f.lower().endswith(('.png','.jpg','.jpeg'))]
    
    if not images:
        print("没有图片")
        return
    
    for img in images:
        path = os.path.join(folder, img)
        print(f"\n正在分析：{img}")
        
        # 仅调用智谱
        final_ans = analyze_zhipu(path)
        print("智谱识别结果:", final_ans)

        # 保存答案
        answer_file = os.path.join(answers_folder, f"answer_{os.path.splitext(img)[0]}.txt")
        with open(answer_file, "w", encoding="utf-8") as f:
            f.write(final_ans if final_ans else "无答案")
        
        print("✅ 已保存答案")

if __name__ == "__main__":
    main()