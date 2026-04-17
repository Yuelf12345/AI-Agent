import os

# 获取脚本所在目录
script_dir = os.path.dirname(os.path.abspath(__file__))

# ========== 练习1：基础文件读取 ==========
print("=== 练习1：读取文件（基础方式） ===")
email_path = os.path.join(script_dir, "email.txt")
f = open(email_path, "r", encoding="utf-8")
email = f.read()
f.close()
print(email)
print()

# ========== 练习2：使用 with 语句读取（推荐） ==========
print("=== 练习2：使用 with 语句读取 ===")
with open(email_path, "r", encoding="utf-8") as f:
    content = f.read()
    print(f"文件总字符数: {len(content)}")
print()

# ========== 练习3：逐行读取文件 ==========
print("=== 练习3：逐行读取文件 ===")
with open(email_path, "r", encoding="utf-8") as f:
    lines = f.readlines()
    for i, line in enumerate(lines, 1):
        print(f"第{i}行: {line.rstrip()}")
print()

# ========== 练习4：写入文件 ==========
print("=== 练习4：写入新文件 ===")
output_path = os.path.join(script_dir, "output.txt")
with open(output_path, "w", encoding="utf-8") as f:
    f.write("这是第一行\n")
    f.write("这是第二行\n")
    f.write("这是第三行\n")
print(f"已写入文件: {output_path}")
print()

# ========== 练习5：追加内容到文件 ==========
print("=== 练习5：追加内容 ===")
with open(output_path, "a", encoding="utf-8") as f:
    f.write("这是追加的内容\n")
    f.write("再追加一行\n")
print("已追加内容到文件")
print()

# ========== 练习6：读取并处理数据 ==========
print("=== 练习6：统计邮件信息 ===")
with open(email_path, "r", encoding="utf-8") as f:
    content = f.read()
    word_count = len(content.split())
    line_count = content.count('\n') + 1
    print(f"总行数: {line_count}")
    print(f"总单词数: {word_count}")
print()

# ========== 练习7：复制文件 ==========
print("=== 练习7：复制文件 ===")
copy_path = os.path.join(script_dir, "email_copy.txt")
with open(email_path, "r", encoding="utf-8") as source:
    with open(copy_path, "w", encoding="utf-8") as target:
        target.write(source.read())
print(f"已复制文件到: {copy_path}")
print()

# ========== 练习8：文件存在性检查 ==========
print("=== 练习8：检查文件是否存在 ===")
test_files = ["email.txt", "output.txt", "nonexistent.txt"]
for filename in test_files:
    filepath = os.path.join(script_dir, filename)
    if os.path.exists(filepath):
        size = os.path.getsize(filepath)
        print(f"✓ {filename} 存在 (大小: {size} 字节)")
    else:
        print(f"✗ {filename} 不存在")

print("\n练习完成！")