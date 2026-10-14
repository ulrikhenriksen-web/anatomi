# Knoglequiz – anatomidatabase (Fase 1, v0.3)

Filer: `bones.json`, `muscles.json`, `tendons.json`, `ligaments.json`. Pipeline: `build.py` + `extra.py` (data), `verify.py` (kildetjek), `validate.py` (skema). Hentede kildekopier (2026-10-14): `ta2.csv` (Wikidata TA2), `musc.wiki` (Wikipedia-muskeltabel), `pages/*.json` (enkelte Wikipedia-artikler, wikitekst).

## Skema (kun additive ændringer siden v0.1)
Fælles: `id`, `name_da`, `name_la_ta2`, `ta2_id`, `region`, `sources[]` (lærebøger, generelle), `name_en` (engelsk opslagsnavn, ny), `source_urls[]`, `source_check{}`, `verification` (`verified`|`needs_review`), `verification_note`.
- **bones**: `type`, `count_in_body`, `landmarks[]`. Sesamknogler tilføjet: Ossa sesamoidea manus/pedis, Fabella. Patella og os pisiforme er i forvejen typen `sesamknogle`.
- **muscles**: `origin_da`, `insertion_da`, `innervation{nerve,segments}`, `function_da`, `blood_supply_da`, `verification_strength` (`strong`|`weak`, ny).
- **tendons**: `associated_muscles[]`, `attachment_da`.
- **ligaments** (ny fil): `id` (`ligament_*`), `name_da`, `name_la_ta2`, `ta2_id`, `region`, `attachment_from_da`, `attachment_to_da`, `function_da`, `name_en`, `sources[]`, `source_urls[]`, `source_check{}`, `verification`, `verification_note`.

## Verifikationsmetode
1. **TA2**: latinsk navn matches mod Wikidata-labels (P7173 TA2 ID; samme data som ta2viewer.openanatomy.org). Ellers bruges Wikidata-item'et for den matchende Wikipedia-artikel (`via`), ellers infoboksens TA2-felt.
2. **Muskler**: Wikipedia-muskeltabellen eller musklens egen artikel (infoboksens Origin/Insertion/Nerve). Krav: innervation matcher på nerve-stikord eller segmenter, og udspring/hæfte deler knoglestikord.
   - `verification_strength = weak` betyder, at mindst ét af felterne (udspring/hæfte) ikke indeholdt knoglestikord på begge sider. Feltet er da ikke modsagt, men heller ikke stærkt bekræftet: læs `source_check`.
3. **Sener/ligamenter**: TA2 bekræftet (via label eller artiklens Wikidata-item), og alle knoglestikord i hæfte-felterne skal findes i Wikipedia-artiklen.
   - Sener, hvis artikel er musklens artikel, verificeres kun på hæfte. `ta2_id` er da tomt (se `source_check.wikipedia_page.note`).
4. Funktion og blodforsyning er ikke automatisk krydstjekket. Wikipedia/Wikidata er sekundære kilder. Alt er automatisk stikordskontrol, ikke manuel fagfællebedømmelse.

## Dækning

### bones (104, verified 66)
| Region | Antal | Verified |
|---|---|---|
| brystkasse | 13 | 13 |
| bækken | 6 | 6 |
| hals | 1 | 1 |
| hoved | 17 | 17 |
| nedre ekstremitet | 21 | 11 |
| ryg | 24 | 4 |
| øvre ekstremitet | 22 | 14 |
### muscles (213, verified 206)
| Region | Antal | Verified |
|---|---|---|
| brystkasse | 7 | 7 |
| brystkasse/skulder | 4 | 4 |
| bug/bækken | 6 | 6 |
| bækken | 11 | 8 |
| hals | 28 | 27 |
| hoved | 40 | 39 |
| nedre ekstremitet | 53 | 51 |
| ryg | 12 | 12 |
| ryg/hals | 6 | 6 |
| ryg/skulder | 5 | 5 |
| øvre ekstremitet | 41 | 41 |
### tendons (56, verified 47)
| Region | Antal | Verified |
|---|---|---|
| brystkasse | 1 | 0 |
| bug/bækken | 2 | 2 |
| bækken | 1 | 0 |
| hals | 2 | 2 |
| hoved | 2 | 2 |
| nedre ekstremitet | 23 | 19 |
| ryg | 2 | 2 |
| øvre ekstremitet | 23 | 20 |
### ligaments (39, verified 37)
| Region | Antal | Verified |
|---|---|---|
| brystkasse | 1 | 1 |
| bækken | 5 | 5 |
| hals | 3 | 3 |
| nedre ekstremitet | 15 | 14 |
| ryg | 5 | 5 |
| øvre ekstremitet | 10 | 9 |

## Resterende needs_review
- muscles (7): Musculus levator ani, Musculus rectus lateralis, Musculus gemellus superior, Musculus gemellus inferior, Musculus transversus perinei superficialis, Musculus transversus perinei profundus, Musculus aryepiglotticus
- bones (38): Os cuneiforme mediale, Os cuneiforme intermedium, Os cuneiforme laterale, Os metacarpi I, Os metacarpi II, Os metatarsi II, Os metatarsi III, Os metacarpi IV, Os metatarsi IV, Os metacarpi V, Phalanx proximalis manus, Phalanx proximalis pedis, Phalanx media manus, Phalanx media pedis, Phalanx distalis manus, Phalanx distalis pedis, Vertebra cervicalis 3, Vertebra cervicalis 4, Vertebra cervicalis 5, Vertebra cervicalis 6, Vertebra thoracica 1, Vertebra thoracica 2, Vertebra thoracica 3, Vertebra thoracica 4, Vertebra thoracica 5, Vertebra thoracica 6, Vertebra thoracica 7, Vertebra thoracica 8, Vertebra thoracica 9, Vertebra thoracica 10, Vertebra thoracica 11, Vertebra thoracica 12, Vertebra lumbalis 2, Vertebra lumbalis 3, Vertebra lumbalis 4, Vertebra lumbalis 5, Ossa sesamoidea manus, Ossa sesamoidea pedis
- tendons (9): Tendo musculi bicipitis brachii (caput longum), Aponeurosis bicipitalis, Centrum tendineum diaphragmatis, Tendo musculi palmaris longi, Tendo musculi extensoris digitorum longi, Retinaculum musculorum fibularium superius, Tendo musculi obturatorii interni, Tendo musculi iliopsoatis, Corpus perineale
- ligaments (2): Ligamentum talofibulare posterius, Ligamentum collaterale ulnare articulationis metacarpophalangeae pollicis
- weak-verificerede muskler (76): Musculus palmaris longus, Musculus extensor digitorum, Musculus extensor digiti minimi, Musculus extensor indicis, Musculi lumbricales manus, Musculus diaphragma, Musculus orbicularis oculi, Musculus orbicularis oris, Musculus buccinator, Musculus gluteus medius, Musculus gluteus minimus, Musculus piriformis, Musculus obturatorius internus, Musculus quadratus femoris, Musculus vastus lateralis, Musculus vastus medialis, Musculus pectineus, Musculus adductor longus, Musculus adductor brevis, Musculus adductor magnus, Musculus semitendinosus, Musculus extensor digitorum longus, Musculus extensor digitorum brevis, Musculus quadratus plantae, Musculus rectus capitis posterior major, Musculus rectus capitis posterior minor, Musculus obliquus capitis superior, Musculus pyramidalis, Musculus cremaster, Musculus platysma, Musculus sternothyroideus, Musculus occipitofrontalis, Musculus corrugator supercilii, Musculus zygomaticus major, Musculus zygomaticus minor, Musculus levator labii superioris, Musculus levator anguli oris, Musculus risorius, Musculus depressor anguli oris, Musculus depressor labii inferioris, Musculus mentalis, Musculus nasalis, Musculus procerus, Musculus levator palpebrae superioris, Musculus rectus superior, Musculus rectus inferior, Musculus rectus medialis, Musculus obliquus superior, Musculus obliquus inferior, Musculus palatoglossus, Musculus constrictor pharyngis superior, Musculus constrictor pharyngis medius, Musculus constrictor pharyngis inferior, Musculus palmaris brevis, Musculus flexor digiti minimi brevis manus, Musculus obturatorius externus, Musculus abductor digiti minimi pedis, Musculi lumbricales pedis, Musculus sphincter ani externus, Musculus sphincter urethrae externus, Musculus bulbospongiosus, Musculus ischiocavernosus, Musculus levator veli palatini, Musculus tensor veli palatini, Musculus psoas minor, Musculus palatopharyngeus, Musculus salpingopharyngeus, Musculus uvulae, Musculus levator labii superioris alaeque nasi, Musculus depressor septi nasi, Musculus auricularis anterior, Musculus auricularis superior, Musculus auricularis posterior, Musculus puborectalis, Musculus longitudinalis superior linguae, Musculus transversus linguae

## Øvrige huller
- Lærebogshenvisninger er ikke sidespecifikke. Ingen manuel ekspertgennemgang endnu.
- Ikke medtaget: øvrige indre tungemuskler (longitudinalis inferior, verticalis), m. thyroepiglotticus, m. salpingopharyngeus' varianter, multifidi/rotatores per region, flere ledbånd (fx karpale/tarsale enkeltbånd, menisker), mellemhvirvelskiver.
