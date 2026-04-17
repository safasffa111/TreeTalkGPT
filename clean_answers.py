import os

def clean_answers():
    """
    清空answers文件夹中的所有文件
    """
    # 定义answers文件夹路径
    answers_dir = "answers"
    
    # 检查文件夹是否存在
    if not os.path.exists(answers_dir):
        print(f"{answers_dir} 文件夹不存在")
        return
    
    # 检查是否是文件夹
    if not os.path.isdir(answers_dir):
        print(f"{answers_dir} 不是一个文件夹")
        return
    
    # 获取文件夹中的所有文件
    files = os.listdir(answers_dir)
    
    if not files:
        print(f"{answers_dir} 文件夹为空")
        return
    
    # 删除所有文件
    deleted_count = 0
    for file in files:
        file_path = os.path.join(answers_dir, file)
        if os.path.isfile(file_path):
            try:
                os.remove(file_path)
                print(f"已删除: {file}")
                deleted_count += 1
            except Exception as e:
                print(f"删除 {file} 失败: {str(e)}")
    
    print(f"\n清理完成，共删除 {deleted_count} 个文件")

if __name__ == "__main__":
    clean_answers()