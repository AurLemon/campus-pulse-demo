import os
"""Reconstruct fine subject tags from already saved source metadata, no network calls."""
import json,re
from pathlib import Path
from bs4 import BeautifulSoup
root=Path(os.environ.get('CAMPUS_DATA_DIR','.data'))/'books'; categories={}
for path in (root/'raw').glob('list-*.html'):
 category=path.stem.rsplit('-',1)[0][5:]
 soup=BeautifulSoup(path.read_text(),'html.parser')
 for a in soup.select('li.subject-item h2 a'):
  match=re.search(r'/subject/(\d+)',a.get('href',''))
  if match: categories.setdefault('douban-'+match.group(1),set()).add(category)
for filename in ['catalogue.json','candidates.json','turing-catalogue.json','accepted.json']:
 path=root/filename
 if not path.exists():continue
 rows=json.loads(path.read_text())
 for row in rows:
  original=[tag for tag in row['tags'] if tag in {'reading','science','art','culture','psychology','career','learning','technology','language'}]; extra=[]
  if row['id'].startswith('douban-'):extra=sorted(categories.get(row['id'],set()))
  elif row['id'].startswith('ituring-'):
   detail=json.loads((root/'raw'/row['id'].replace('ituring-','turing-')).with_suffix('.json').read_text())
   extra=[c['name'] for branch in detail.get('categories',[]) for c in branch]
   extra += [tag['name'] for tag in detail.get('tags',[]) if not re.search(r'图灵|系列|电子书|上新|新书|最新|独立|人气|上线|经典|套装|育儿|家长|爱心',tag['name']) and tag['name'] not in (detail.get('authorNameString') or '')]
  tags=[]; seen=set()
  aliases={'摄影':'photography','设计':'art','计算机':'technology','经济学':'career','文学':'reading','小说':'reading'}
  original += [aliases[tag] for tag in extra if tag in aliases]
  for tag in original+extra:
   key=tag.lower()
   if key not in seen: tags.append(tag);seen.add(key)
  row['tags']=tags[:8]
 path.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print('Enriched factual subject tags from saved publisher categories and bibliography lists')
