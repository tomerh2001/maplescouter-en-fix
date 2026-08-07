#!/bin/bash
cd "$(dirname "$0")/gamedata"
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
curl -s --max-time 120 "https://maplestory.io/api/GMS/268/mob" -o gms_mob.json &
curl -s --max-time 120 "https://maplestory.io/api/KMS/389/mob" -o kms_mob.json &
curl -s --max-time 180 "https://maplestory.io/api/GMS/268/map" -o gms_map.json &
curl -s --max-time 180 "https://maplestory.io/api/KMS/389/map" -o kms_map.json &
wait
for region in "GMS/268" "KMS/389"; do
  rname=$(echo $region | cut -d/ -f1 | tr 'A-Z' 'a-z')
  pos=0
  while : ; do
    f="${rname}_item_${pos}.json"
    curl -s --max-time 300 "https://maplestory.io/api/${region}/item?startPosition=${pos}&count=20000" -o "$f"
    n=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$f')).length)}catch(e){console.log(0)}")
    echo "$region pos=$pos -> $n"
    [ "$n" -lt 20000 ] && break
    pos=$((pos+20000))
  done
done
echo GAMEDATA_DONE
