import os
"""Reparse existing source lists without relying on optional price field positions."""
import json,re
from pathlib import Path
from bs4 import BeautifulSoup
root=Path(os.environ.get('CAMPUS_DATA_DIR','.data'))/'books'; publishers={}; unresolved=[]
publisher_pattern=re.compile(r'出版社|出版集团|出版公司|出版事業|出版事业|出版有限公司|出版股份|书局|書局|书店|書店|印书馆|印書館|出版文化|出版传媒|Press|Books|Publish|Penguin|Springer|Wiley|Pearson|Oxford|Cambridge|Routledge|Elsevier|McGraw|Dover|Harper|Random House|Prentice|O.Reilly',re.I)
for path in (root/'raw').glob('list-*.html'):
 soup=BeautifulSoup(path.read_text(),'html.parser')
 for item in soup.select('li.subject-item'):
  a=item.select_one('h2 a'); pub=item.select_one('.pub')
  if not a or not pub: continue
  key='douban-'+re.search(r'/subject/(\d+)',a['href']).group(1)
  parts=[p.strip() for p in pub.get_text(' ',strip=True).split('/')]
  matches=[part for part in parts[1:] if publisher_pattern.search(part)]
  if matches:publisher=matches[0]
  else:
   dates=[i for i,p in enumerate(parts) if re.match(r'^(?:18|19|20)\d{2}(?:[-年./]|$)',p)]
   if dates and dates[0]>1:publisher=parts[dates[0]-1]
   else: unresolved.append({'id':key,'raw':parts});continue
  publishers[key]=publisher
repairs=[]
for filename in ['catalogue.json','candidates.json','accepted.json']:
 path=root/filename
 rows=json.loads(path.read_text())
 for row in rows:
  if row['id'] in publishers:
   old=row['publisher'];row['publisher']=publishers[row['id']]
   if old!=row['publisher']:repairs.append({'file':filename,'id':row['id'],'old':old,'publisher':row['publisher']})
 path.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
report={'repaired':repairs,'unresolved':list({row['id']:row for row in unresolved}.values())}
(root/'metadata-repair-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'repairedFields':len(repairs),'unresolved':report['unresolved']},ensure_ascii=False))
