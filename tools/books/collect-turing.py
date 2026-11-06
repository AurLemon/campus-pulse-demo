import os
"""Public publisher catalogue API. Metadata only, resumable, 1.2 sec between requests."""
import requests,time,json,re
from pathlib import Path
BASE=Path(os.environ.get('CAMPUS_DATA_DIR','.data'))/'books'; RAW=BASE/'raw'; RAW.mkdir(parents=True,exist_ok=True)
s=requests.Session();s.headers['User-Agent']='CampusPulseCourseMetadata/1.0 (github.com/AurLemon)'
def fetch(url,key):
 p=RAW/(key+'.json')
 if p.exists():return json.loads(p.read_text())
 time.sleep(1.2);r=s.get(url,timeout=25)
 if r.status_code in (403,429):raise RuntimeError(f'SOURCE_RATE_LIMIT_{r.status_code}')
 r.raise_for_status();data=r.json();p.write_text(json.dumps(data,ensure_ascii=False,indent=2));return data
rows=[];ids=set()
for category,tag,academic,pages in [(140,'science',True,2),(1,'technology',True,4),(16,'science',False,3),(108,'psychology',False,1),(44,'art',False,1)]:
 for page in range(1,pages+1):
  data=fetch(f'https://api.ituring.com.cn/api/Book?category={category}&page={page}&sort=hot',f'turing-list-{category}-{page}')
  for entry in data.get('bookItems',[]):
   if entry['id'] in ids:continue
   if re.search(r'小学|初中|高中|亲子|儿童|少儿|GESP|CSP-J|青少年',entry['name']):continue
   ids.add(entry['id'])
   try: book=fetch(f'https://api.ituring.com.cn/api/Book/{entry["id"]}',f'turing-{entry["id"]}')
   except requests.HTTPError as e:
    print(f'DETAIL_ERROR {entry["id"]} {e}',flush=True);continue
   author=book.get('authorNameString') or entry.get('authorNameString')
   publisher=book.get('pressName')
   if not author or not publisher or not book.get('abstract') or not book.get('coverKey'):continue
   rows.append({'id':f'ituring-{entry["id"]}','title':book['name'],'authors':[author],'publisher':publisher,'description':re.sub('<[^>]*>','',book['abstract']),'language':'zh','isbn13':re.sub(r'[^0-9X]','',book.get('isbn','')) or None,'workKey':re.sub(r'[\W_]+','',book['name']+author).lower(),'coverUrl':'https://file.ituring.com.cn/LargeCover/'+book['coverKey'],'tags':[tag,'learning'] if academic else [tag],'academic':academic,'source':'ituring-publisher-catalogue','sourceUrl':f'https://www.ituring.com.cn/book/{entry["id"]}','fetchedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'copies':3,'detailVerified':True})
   (BASE/'turing-catalogue.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
   print(f'{len(rows)} {book["name"]}',flush=True)
