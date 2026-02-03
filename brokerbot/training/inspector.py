from curl_cffi import requests
from bs4 import BeautifulSoup

# Use the exact same headers/impersonation as before
url = "https://warosu.org/vt/thread/108258576"

print(f"Fetching {url}...")
try:
    response = requests.get(
        url,
        impersonate="chrome110",
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        },
        timeout=15
    )
    
    print(f"Status Code: {response.status_code}")
    
    # 1. DUMP THE RAW HTML
    with open("debug_dump.html", "wb") as f:
        f.write(response.content)
    print("✅ Saved response to 'debug_dump.html'. Open this file in your browser.")

    # 2. QUICK SELECTOR TEST
    soup = BeautifulSoup(response.content, 'html.parser')
    
    # Check if we hit the Cloudflare challenge page
    title = soup.title.string if soup.title else "No Title"
    print(f"Page Title: {title}")
    
    if "Just a moment" in title or "Cloudflare" in title:
        print("\n🚨 DIAGNOSIS: CLOUDFLARE BLOCK. The script is not bypassing the check.")
    else:
        # Check for posts
        posts = soup.find_all("table", class_="post")
        print(f"\n🔍 Found {len(posts)} elements matching 'table.post'")
        
        # Try a fallback selector if table.post failed
        if len(posts) == 0:
            print("   -> Trying fallback: searching for any 'blockquote'...")
            quotes = soup.find_all("blockquote")
            print(f"   -> Found {len(quotes)} blockquotes.")

except Exception as e:
    print(f"💥 Error: {e}")