import os

def clean_screenshots():
    """
    删除screenshots文件夹中的所有文件
    """
    # 定义screenshots文件夹路径
    screenshots_dir = "screenshots"
    
    # 检查文件夹是否存在
    if not os.path.exists(screenshots_dir):
        print(f"{screenshots_dir} 文件夹不存在")
        return
    
    # 检查是否是文件夹
    if not os.path.isdir(screenshots_dir):
        print(f"{screenshots_dir} 不是一个文件夹")
        return
    
    # 获取文件夹中的所有文件
    files = os.listdir(screenshots_dir)
    
    if not files:
        print(f"{screenshots_dir} 文件夹为空")
        return
    
    # 删除所有文件
    deleted_count = 0
    for file in files:
        file_path = os.path.join(screenshots_dir, file)
        if os.path.isfile(file_path):
            try:
                os.remove(file_path)
                print(f"已删除: {file}")
                deleted_count += 1
            except Exception as e:
                print(f"删除 {file} 失败: {str(e)}")
    
    print(f"\n清理完成，共删除 {deleted_count} 个文件")

if __name__ == "__main__":
    clean_screenshots()