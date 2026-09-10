import re

filepath = 'release4/extracted/frontend/assets/index-DWWGMt0x.js'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

original_len = len(content)

# Fix 1: Remove publisher from empty form state
# Pattern: publisher:``,year:``
content = content.replace('publisher:``', '')

# Fix 2: Remove publisher||'—' display from book details
# The display pattern is: [n.publisher||`—`,n.year?`, ${n.year}`:``]
# We want to keep the year part but remove publisher
content = content.replace('n.publisher||`—`,n.year?`, ${n.year}`:``]', 'n.year||``]')

# Also handle the case where publisher was already the only thing shown
content = content.replace('n.publisher||`—`', '')

# Fix 3: Remove "N/A Department" display
# Pattern: [R.department||`N/A`,` Department`]
content = content.replace('R.department||`N/A`,` Department`', '``')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'Done. File size: {original_len} -> {len(content)} (removed {original_len - len(content)} chars)')

# Verify fixes
with open(filepath, 'r', encoding='utf-8') as f:
    verify = f.read()

print(f'Publisher in form state: {"publisher:``" in verify}')
print(f'Publisher display: {"n.publisher||" in verify}')
print(f'N/A Department: {"N/A`,` Department`" in verify}')
