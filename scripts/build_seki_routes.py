import json, math, heapq
from pathlib import Path
from scipy.spatial import cKDTree
import argparse
parser = argparse.ArgumentParser(description='Build approximate Big SEKI daily routes on mapped NPS/USFS trails.')
parser.add_argument('--park-trails', required=True, type=Path)
parser.add_argument('--forest-trails', required=True, type=Path)
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
def xy(p):return (p[0]*89000,p[1]*111200)
def dist(a,b):return math.dist(xy(a),xy(b))
coords=[]; indices={}; graph=[]; endpoints=[]
def node(p):
 p=tuple(round(v,7) for v in p[:2])
 if p not in indices:indices[p]=len(coords);coords.append(p);graph.append({})
 return indices[p]
def edge(a,b):
 if a==b:return
 d=dist(coords[a],coords[b]);graph[a][b]=d;graph[b][a]=d
for path in [args.park_trails, args.forest_trails]:
 for f in json.load(open(path))['features']:
  if path == args.forest_trails and 'KEARSARGE' not in (f['properties']['NAME'] or ''):continue
  lines=[f['geometry']['coordinates']] if f['geometry']['type']=='LineString' else f['geometry']['coordinates']
  for line in lines:
   prev=node(line[0]); endpoints.append(prev)
   for p in line[1:]:
    a=coords[prev];n=max(1,math.ceil(dist(a,p)/20))
    for k in range(1,n+1):
     nxt=node([a[0]+(p[0]-a[0])*k/n,a[1]+(p[1]-a[1])*k/n]);edge(prev,nxt);prev=nxt
   endpoints.append(prev)
tree=cKDTree([xy(p) for p in coords])
# Close tiny cartographic gaps at mapped junctions only.
for a in endpoints:
 for b in tree.query_ball_point(xy(coords[a]),18):edge(a,b)
print('Graph',len(coords),len(endpoints),flush=True)
def nearest(p):
 d,i=tree.query(xy(p));return int(i),float(d)
def route(a,b):
 pq=[(0,a)];best={a:0};prev={}
 while pq:
  d,v=heapq.heappop(pq)
  if d!=best[v]:continue
  if v==b:
   out=[v]
   while v!=a:v=prev[v];out.append(v)
   return out[::-1],d
  for w,c in graph[v].items():
   nd=d+c
   if nd<best.get(w,float('inf')):best[w]=nd;prev[w]=v;heapq.heappush(pq,(nd,w))
 raise ValueError(('Disconnected',coords[a],coords[b]))
x=json.load(open(ROOT/'data/inat-big-seki.json'));obs=x['observations'];days=x['days']
camps=[ [next(o['lng'] for o in reversed(obs) if o['day']==d['date']),next(o['lat'] for o in reversed(obs) if o['day']==d['date'])] for d in days[:-1]]
# Camp areas used as route endpoints, never as exact tent locations.
camps[2]=[-118.579425,37.052194] # next morning along the Middle Fork
camps[8]=[-118.370372,36.714079] # north of Forester, next morning
camps[9]=[-118.41375,36.5769] # Junction Meadow, Kern
camps[12]=[-118.585165,36.636762] # Deadman Canyon, next morning
# Gilbert Lake endpoint is on its western shore, east of Kearsarge Pass.
features=[]
for i,day in enumerate(days):
 group=[o for o in obs if o['day']==day['date']]
 start=[-118.5835969,36.7962822] if i==0 else camps[i-1]
 end=camps[i] if i<14 else [-118.5835969,36.7962822]
 anchors=[nearest(start)[0]];max_snap=0
 for o in group:
  if o['accuracy_m']>100:continue
  n,d=nearest([o['lng'],o['lat']]);max_snap=max(max_snap,d)
  if d>350:continue
  if dist(coords[anchors[-1]],coords[n])>=650:anchors.append(n)
 anchors.append(nearest(end)[0]);full=[];length=0
 for a,b in zip(anchors,anchors[1:]):
  p,d=route(a,b);full.extend(p if not full else p[1:]);length+=d
 # Remove short GPS-wobble excursions, retaining larger deliberate returns.
 simplified=[];pos={}
 for n in full:
  if n in pos and len(simplified)-pos[n]<75:
   cut=pos[n]
   for old in simplified[cut+1:]:pos.pop(old,None)
   simplified=simplified[:cut+1]
  else:pos[n]=len(simplified);simplified.append(n)
 points=[[round(v,6) for v in coords[n]] for n in simplified]
 props={'day':day['date'],'label':day['label'],'start':start,'end':end,'camp':x['overnight_stops'][i]['name'] if i<14 else None,'camp_uncertain':i==7}
 features.append({'type':'Feature','properties':props,'geometry':{'type':'LineString','coordinates':points}})
 print(day['date'],len(anchors),round(length/1609,1),'miles',len(points),'maxsnap',round(max_snap),flush=True)
(ROOT/'data/big-seki-routes.geojson').write_text(json.dumps({'type':'FeatureCollection','source':'NPS SEKI Park Atlas trails (layer 13) and USFS Kearsarge Pass trails (layer 14)','source_url':'https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/SEKI_ParkAtlas2_4_HikingandBackpacking_MASTER/FeatureServer','route_kind':'approximate trail itinerary','features':features},separators=(',',':'))+'\n')
