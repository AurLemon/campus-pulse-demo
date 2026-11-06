import os
"""Fetch public bibliographic metadata only, one request/second, resumable.
Requires requests + beautifulsoup4 in an external environment.
Stops on 403/429, never rotates proxy/IP. Does not fetch ebook texts.
"""
import requests, time, json, re, hashlib, sys
from pathlib import Path
from bs4 import BeautifulSoup
BASE=Path(os.environ.get('CAMPUS_DATA_DIR','.data'))/'books'; RAW=BASE/'raw'; RAW.mkdir(parents=True, exist_ok=True)
s=requests.Session(); s.headers['User-Agent']='CampusPulseCourseMetadata/1.0 (educational bibliography; github.com/AurLemon)'
def fetch(url, key):
 p=RAW/(key+'.html')
 if p.exists(): return p.read_text()
 time.sleep(1.2)
 r=s.get(url,timeout=25)
 if r.status_code in (403,429): raise RuntimeError(f'SOURCE_RATE_LIMIT {r.status_code} {url}')
 r.raise_for_status(); p.write_text(r.text); return r.text
categories=[('文学','reading',False),('小说','reading',False),('历史','culture',False),('社会学','culture',False),('心理学','psychology',False),('科普','science',False),('艺术','art',False),('计算机','technology',True),('数学','science',True),('教材','learning',True),('大学教材','learning',True),('经济学','career',True),('英语','language',True)]
rows={}
for category,tag,academic in categories:
 for page in range(3):
  url=f'https://book.douban.com/tag/{category}?start={page*20}&type=T'
  html=fetch(url,f'list-{category}-{page}')
  soup=BeautifulSoup(html,'html.parser')
  items=soup.select('li.subject-item')
  if not items: raise RuntimeError(f'EMPTY_SOURCE {url}')
  for item in items:
   link=item.select_one('h2 a'); cover=item.select_one('.pic img'); pub=item.select_one('.pub'); intro=item.select_one('p')
   if not all([link,cover,pub,intro]): continue
   key=re.search(r'/subject/(\d+)',link['href']).group(1)
   if key in rows:
    rows[key]['academic'] |= academic
    if tag not in rows[key]['tags']: rows[key]['tags'].append(tag)
    continue
   parts=[p.strip() for p in pub.get_text(' ',strip=True).split('/')]
   publisher=next((part for part in parts[1:] if re.search(r'出版社|出版|书局|書局|书店|書店|印书馆|印書館|书社|Press|Books|Publish|Penguin|Springer|Wiley|Pearson|Oxford|Cambridge|Routledge|Elsevier|McGraw|Dover|Harper|Random House|Prentice|O.Reilly',part,re.I)), '')
   if not publisher:
    dates=[i for i,part in enumerate(parts) if re.match(r'^(?:18|19|20)\d{2}(?:[-年./]|$)',part)]
    if dates and dates[0]>1:publisher=parts[dates[0]-1]
   title=link.get('title','').strip(); author=parts[0]
   if not title or not author or not publisher: continue
   rows[key]={'id':'douban-'+key,'title':title,'authors':[author],'publisher':publisher,'description':intro.get_text(' ',strip=True),'language':'zh','isbn13':None,'workKey':re.sub(r'[\W_]+','',title+author).lower(),'coverUrl':cover['src'].replace('/s/public/','/l/public/'),'tags':[tag],'academic':academic,'source':'douban-public-metadata','sourceUrl':link['href'],'fetchedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'copies':3}
  (BASE/'candidates.json').write_text(json.dumps(list(rows.values()),ensure_ascii=False,indent=2))
  print(f'{category}/{page}: {len(rows)} candidates',flush=True)
# Detail metadata preserves full authoritative summary and ISBN. Missing facts never generated.
for i,row in enumerate(rows.values()):
 try:
  soup=BeautifulSoup(fetch(row['sourceUrl'],row['id']),'html.parser')
  info=soup.select_one('#info')
  if not info: continue
  isbn=re.search(r'ISBN:\s*(\d{13})',info.get_text(' ',strip=True))
  if isbn: row['isbn13']=isbn.group(1)
  intros=soup.select('#link-report .intro')
  if intros: row['description']=max((n.get_text('\n',strip=True) for n in intros),key=len)
  image=soup.select_one('#mainpic img')
  if image: row['coverUrl']=image.get('src',row['coverUrl'])
  row['detailVerified']=True
 except requests.RequestException as e:
  print('DETAIL_ERROR',row['id'],str(e),flush=True); continue
 (BASE/'catalogue.json').write_text(json.dumps(list(rows.values()),ensure_ascii=False,indent=2))
 print(f'detail {i+1}/{len(rows)} {row["title"]}',flush=True)
