import { HOME_COVERS } from '@/data/homeCovers';

export type Book = {
  id: string; title: string; author: string; alias: string; genre: string;
  rating: number; likes: string; comments: number; reads: string;
  palette: [string, string]; ink: string; motif: 'crest' | 'snow' | 'compass' | 'manor' | 'moon' | 'feather';
  blurb: string; cover?: number; sample?: boolean; chapters: { title: string; ago: string; body: string }[];
};

const p = (t: string) => t;

export const BOOKS: Book[] = [
  { id: 'golgelerin-mirasi', title: 'Gölgelerin Mirası', author: 'Deniz Karaca', alias: 'kalemgezer', genre: 'Fantastik', rating: 4.9, likes: '2,1B', comments: 512, reads: '12,4B', palette: ['#1F2A22', '#0E1511'], ink: '#D9B56A', motif: 'crest',
    blurb: 'Eski bir ormanın kalbinde mühürlü bir arma, unutulmuş bir hanedanın son varisini çağırıyor.',
    chapters: [
      { title: '24. Bölüm', ago: '3 dk önce', body: p('Ormanın kenarında fener ışığı titredi. Elif, armanın soğuk metaline dokunduğunda yaprakların arasından bir fısıltı yükseldi.\n\n"Geç kaldın," dedi ses. "Ama hiç gelmemekten iyidir."\n\nGeceyi bölen tek şey, uzaklardaki saat kulesinin yorgun çanıydı.') },
      { title: '23. Bölüm', ago: '2 gün önce', body: p('Kütüphanenin tozlu rafları arasında, mürekkebi solmuş bir harita buldu. Haritanın köşesinde aynı arma vardı.') },
    ] },
  { id: 'kisin-son-mektubu', title: 'Kışın Son Mektubu', author: 'Melis Aydın', alias: 'mavimurekkep', genre: 'Roman', rating: 4.8, likes: '1,4B', comments: 328, reads: '8,9B', palette: ['#DCE4EA', '#8FA3B5'], ink: '#2E3B4A', motif: 'snow',
    blurb: 'Karla örtülü bir kasabada, kırk yıl gecikmiş bir mektup iki ailenin kaderini yeniden yazıyor.',
    chapters: [
      { title: '12. Bölüm', ago: '1 sa önce', body: p('Zarfın üzerindeki pul, artık basılmayan bir yılı gösteriyordu. Nermin Hanım gözlüğünü düzeltti ve ilk satırı yüksek sesle okudu.') },
    ] },
  { id: 'altin-pusula', title: 'Altın Pusula', author: 'Kaan Erdem', alias: 'yolgezer', genre: 'Macera', rating: 4.7, likes: '980', comments: 211, reads: '6,2B', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'compass',
    blurb: 'Kuzeyi değil, kaybettiğin şeyi gösteren bir pusula. Ve onu arayan üç yabancı.',
    chapters: [
      { title: '7. Bölüm', ago: '5 sa önce', body: p('Pusulanın ibresi bir kez daha döndü, bu kez limana değil, eski çarşının dar sokaklarına.') },
    ] },
  { id: 'sisli-konak', title: 'Sisli Konak', author: 'Ayla Tunç', alias: 'edebiyatperisi', genre: 'Gerilim', rating: 4.9, likes: '3,2B', comments: 604, reads: '15,1B', palette: ['#3A3640', '#15131A'], ink: '#CFC6B4', motif: 'manor',
    blurb: 'Boğaz kıyısındaki konakta her gece aynı saatte bir piyano çalıyor. Konakta piyano yok.',
    chapters: [ { title: '18. Bölüm', ago: 'dün', body: p('Merdivenin on üçüncü basamağı yine gıcırdadı. Oysa kimse yukarı çıkmıyordu.') } ] },
  { id: 'ruya-kapani', title: 'Rüya Kapanı', author: 'Selin Oral', alias: 'hikayeci', genre: 'Hikaye', rating: 4.8, likes: '2,7B', comments: 290, reads: '9,7B', palette: ['#26344F', '#0F1626'], ink: '#E9CF8E', motif: 'moon',
    blurb: 'Rüyaları toplayan bir kız, bir gece kendi rüyasına yakalanır.',
    chapters: [ { title: '9. Bölüm', ago: '3 gün önce', body: p('Hilal, pencerenin pervazına bir şeker gibi oturmuştu.') } ] },
  { id: 'tas-ve-tuy', title: 'Taş ve Tüy', author: 'Emre Yalın', alias: 'masalci', genre: 'Şiir', rating: 4.6, likes: '1,8B', comments: 144, reads: '4,3B', palette: ['#D8CFC2', '#8C7F70'], ink: '#3B2416', motif: 'feather',
    blurb: 'Ağırlık ile hafiflik arasında yazılmış kırk iki kısa şiir.',
    chapters: [ { title: '42. Şiir', ago: '1 hf önce', body: p('Taş sustu,\ntüy anlattı;\nrüzgâr ikisini de\naynı yere bıraktı.') } ] },
  { id: 'sessiz-ormanin-gunlugu', title: 'Sessiz Ormanın Günlüğü', author: 'P. Yılmaz', alias: 'sessiz', genre: 'Fantastik', rating: 4.7, likes: '128', comments: 944, reads: '12.4b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/forest.webp'),
    blurb: 'Sessiz Ormanın Günlüğü, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Sessiz Ormanın Günlüğü için ilk bölüm.') } ] },
  { id: 'zamanin-kiyisinda', title: 'Zamanın Kıyısında', author: 'M. Debiv', alias: 'zamanin', genre: 'Roman', rating: 4.7, likes: '988', comments: 211, reads: '9.9b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/time.webp'),
    blurb: 'Zamanın Kıyısında, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Zamanın Kıyısında için ilk bölüm.') } ] },
  { id: 'tasin-sirri', title: 'Taşın Sırrı', author: 'X. Kaira', alias: 'tasin', genre: 'Gizem', rating: 4.7, likes: '734', comments: 190, reads: '7.0b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/stone.webp'),
    blurb: 'Taşın Sırrı, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Taşın Sırrı için ilk bölüm.') } ] },
  { id: 'ruzgarin-sesi', title: 'Rüzgarın Sesi', author: 'A. Eren', alias: 'ruzgarin', genre: 'Roman', rating: 4.7, likes: '452', comments: 128, reads: '5.2b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/night.webp'),
    blurb: 'Rüzgarın Sesi, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Rüzgarın Sesi için ilk bölüm.') } ] },
  { id: 'golgelerin-dili', title: 'Gölgelerin Dili', author: 'L. Kara', alias: 'golgelerin', genre: 'Fantastik', rating: 4.7, likes: '321', comments: 95, reads: '4.1b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/shadows.webp'),
    blurb: 'Gölgelerin Dili, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Gölgelerin Dili için ilk bölüm.') } ] },
  { id: 'uyanis', title: 'Uyanış', author: 'P. Demir', alias: 'uyanis', genre: 'Hikaye', rating: 4.7, likes: '589', comments: 143, reads: '6.3b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/time.webp'),
    blurb: 'Uyanış, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Uyanış için ilk bölüm.') } ] },
  { id: 'gece-defteri', title: 'Gece Defteri', author: 'B. Wizay', alias: 'gece', genre: 'Şiir', rating: 4.7, likes: '420', comments: 63, reads: '3.3b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/night.webp'),
    blurb: 'Gece Defteri, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Gece Defteri için ilk bölüm.') } ] },
  { id: 'kayip-pusulanin-izinde', title: 'Kayıp Pusulanın İzinde', author: 'G. Polat', alias: 'kayip', genre: 'Macera', rating: 4.7, likes: '589', comments: 57, reads: '2.8b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/time.webp'),
    blurb: 'Kayıp Pusulanın İzinde, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Kayıp Pusulanın İzinde için ilk bölüm.') } ] },
];

type Seed = [id: string, title: string, genre: string, author: string, alias: string, palette: [string, string], blurb: string, chapter: string];
const SEEDS: Seed[] = [
  ['gece-ve-sessizlik', 'Gece ve Sessizlik', 'Roman', 'Elif M. Yılmaz', 'elifmy', ['#1B2433', '#0C111A'], 'Yağmurlu bir şehirde gece vardiyasından dönen bir kadın, her akşam aynı pencerede yanan ışığın sırrını merak eder.', 'Yağmur, sokak lambalarının altında ince iplikler gibi parlıyordu. Leyla otobüsten indiğinde saat biri geçmişti.\n\nKarşı apartmanın dördüncü katında yine o ışık yanıyordu. Üç aydır, her gece, aynı saatte.\n\nŞemsiyesini kapattı, bir süre ıslanmayı seçti. Bazı sorular insanı ancak yağmurun altında bekletirdi.'],
  ['zambaklarin-dili', 'Zambakların Dili', 'Şiir', 'Deniz Arslan', 'denizarslan', ['#EEF0E8', '#B9C2AE'], 'Beyaz çiçeklerin sessizliğine yazılmış kısa şiirler.', 'Bir zambak açar\nkimse görmeden;\nsabah, onu\nilk kez söyleyen olur.\n\nSen de öyle geldin:\nadın konmadan önce\nkokun vardı odada.'],
  ['yildiz-tozu', 'Yıldız Tozu', 'Deneme', 'Mira Koç', 'mirakoc', ['#141A3A', '#070A1C'], 'Gökyüzüne bakmanın, küçük hissetmenin ve yine de umut etmenin üzerine denemeler.', 'Çocukken yıldızların bize göz kırptığını sanırdım. Sonra öğrendim: gördüğümüz ışık, çoktan yola çıkmış eski bir mektuptu.\n\nBelki de insan da böyledir. Bugün söylediğimiz bir cümle, yıllar sonra birinin karanlığına ulaşır.'],
  ['kayip-haritanin-izinde', 'Kayıp Haritanın İzinde', 'Macera', 'Can Eren', 'caneren', ['#D9C39A', '#8E6B3E'], 'Dedesinin sandığında bulduğu yarım harita, genç bir arkeoloğu Ege kıyılarında bir yolculuğa çıkarır.', 'Haritanın kenarı yanmıştı; geriye yalnızca bir koy, üç tepe ve mürekkeple çizilmiş bir çarpı kalmıştı.\n\nKerem parmağını çarpının üzerinde gezdirdi. "Burası," dedi, "dedemin hiç anlatmadığı yer."'],
  ['sehrin-ruyasi', 'Şehrin Rüyası', 'Öykü', 'Merve Kaya', 'mervekaya', ['#BFD3E6', '#6F8FB3'], 'Bulutların üstünde yükselen bir şehir, onu yalnızca uykusuz gecelerde görenleri bekliyor.', 'O şehri ilk kez dördüncü uykusuz gecemde gördüm. Bulutların arasından kuleler yükseliyordu; pencereleri sabah gibi aydınlıktı.\n\nKimseye anlatmadım. Anlatırsam kaybolacağını biliyordum.'],
  ['sisli-sabahlar', 'Sisli Sabahlar', 'Anı', 'Ali Demir', 'alidemir', ['#C9CFC4', '#7D877A'], 'Karadeniz yaylasında geçen bir çocukluğun sisli sabahlarından kalan anılar.', 'Yaylada sabahlar sisle başlardı. Annem kapıyı açar, "Yine bulutun içindeyiz," derdi.\n\nBen o sisin içinde kaybolmaktan hiç korkmazdım. Çünkü ne kadar uzağa gitsem, ocaktaki çayın kokusu beni bulurdu.'],
  ['yildizlarin-altinda', 'Yıldızların Altında', 'Romantik', 'Selin Demir', 'selindemir', ['#1E2647', '#0B1026'], 'Bir yaz gecesi gözlemevinde tanışan iki yabancı, aynı yıldızı farklı isimlerle çağırır.', 'Teleskobun başında sıra beklerken konuştular ilk kez.\n\n"Şuna Vega derler," dedi Arda.\n\nNil gülümsedi. "Babaannem ona Çoban Yıldızı derdi."\n\nİkisi de haklıydı. Gece boyunca bunu tartıştılar.'],
  ['sessiz-kutuphane', 'Sessiz Kütüphane', 'Kurgusal', 'Emre Tunç', 'emretunc', ['#5A3E2B', '#2A1C12'], 'Kapanış saatinden sonra raflarındaki kitapların yer değiştirdiği eski bir kütüphane.', 'Kütüphaneci her akşam ışıkları kapatmadan önce rafları sayardı. Bin iki yüz on dört kitap.\n\nSabah ise sayı hep bir fazla çıkıyordu. Ve fazladan gelen kitabın ilk sayfası, her seferinde boştu.'],
  ['son-yaprak', 'Son Yaprak', 'Roman', 'Deniz Polat', 'denizpolat', ['#B5632E', '#6B3418'], 'Bir sonbahar boyunca hastane penceresinden görünen ağaç, iki yaşlı dostun son sohbetlerine tanık olur.', 'Pencereden görünen çınarın yaprakları birer birer düşüyordu.\n\n"Sonuncusu düştüğünde," dedi Hüsnü Bey, "ben de giderim herhalde."\n\nRıza Bey kahkahayı bastı. "Sen o ağaçtan da inatçısın."'],
];
const HOME_BOOKS: Book[] = SEEDS.map(([id, title, genre, author, alias, palette, blurb, chapter]) => ({
  id, title, author, alias, genre, rating: 0, likes: '0', comments: 0, reads: '0', palette, ink: '#F6EEDD', motif: 'feather', sample: true,
  cover: HOME_COVERS[id], blurb: blurb + ' (Örnek içerik)', chapters: [{ title: '1. Bölüm (örnek)', ago: 'örnek', body: chapter }],
}));
BOOKS.push(...HOME_BOOKS);

export const FEATURED = BOOKS.slice(0, 3);
export const POPULAR = BOOKS.slice(3, 6);
export const HOME_SECTIONS = [
  { id: 'oneriler', title: 'Afilli Önerileri', ids: ['gece-ve-sessizlik', 'zambaklarin-dili', 'yildiz-tozu'] },
  { id: 'cok-okunan', title: 'Çok Okunanlar', ids: ['kayip-haritanin-izinde', 'sehrin-ruyasi', 'sisli-sabahlar'] },
  { id: 'populer', title: 'Popüler Kitaplar', ids: ['yildizlarin-altinda', 'sessiz-kutuphane', 'son-yaprak'] },
];
export const getBook = (id?: string) => BOOKS.find((b) => b.id === id);

export const NEW_CHAPTERS = [
  { bookId: 'golgelerin-mirasi', ci: 0, reads: '12,4B okuma' },
  { bookId: 'altin-pusula', ci: 0, reads: '6,2B okuma' },
  { bookId: 'kisin-son-mektubu', ci: 0, reads: '8,9B okuma' },
  { bookId: 'sisli-konak', ci: 0, reads: '15,1B okuma' },
];

export const trNorm = (s: string) =>
  s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[âî]/g, (c) => (c === 'â' ? 'a' : 'i')).replace(/@/g, '').trim();

export type Article = { id: string; kind: 'bulten' | 'dergi' | 'ozel'; title: string; meta: string; summary: string; body: string };

export const ARTICLES: Article[] = [
  { id: 'b1', kind: 'bulten', title: 'Haftanın Kalemleri', meta: 'Bülten · Sayı 14', summary: 'Bu hafta en çok okunan beş yeni yazar ve ilk bölümleri.', body: 'Bu hafta topluluğa katılan kalemler arasında, kısa öykü ile şiir arasında gezinen sesler öne çıktı. Okuma listenize eklemeniz için seçtiklerimiz: kalemgezer, mavimurekkep ve yolgezer.' },
  { id: 'b2', kind: 'bulten', title: 'Yazım Atölyesi Notları', meta: 'Bülten · Sayı 13', summary: 'Diyalog yazarken sık yapılan üç hata ve küçük çözümleri.', body: 'Diyaloğu taşıyan şey bilgi değil, gerilimdir. Karakterleriniz birbirine her şeyi anlatıyorsa, okurun keşfedecek bir şeyi kalmaz.' },
  { id: 'b3', kind: 'bulten', title: 'Kış Okuma Listesi', meta: 'Bülten · Sayı 12', summary: 'Uzun geceler için yedi sıcak kitap önerisi.', body: 'Kışın Son Mektubu ile başlayıp Taş ve Tüy ile bitirmenizi öneriyoruz.' },
  { id: 'd1', kind: 'dergi', title: 'Mürekkep ve Sis', meta: 'Dergi · Aralık', summary: 'Gotik edebiyatın İstanbul sokaklarındaki izleri üzerine uzun bir deneme.', body: 'Boğaz kıyısındaki eski yalılar, yalnızca mimari değil, anlatı mirası da taşır. Sisli Konak bu mirasın bugünkü bir yankısı.' },
  { id: 'd2', kind: 'dergi', title: 'Bir Yazarla Söyleşi: masalcı', meta: 'Dergi · Kasım', summary: 'Şiirde ağırlık ve hafiflik üzerine bir sohbet.', body: '"Her şiir bir taşla başlar," diyor masalcı. "Sonra tüye dönüşmesini beklerim."' },
  { id: 'd3', kind: 'dergi', title: 'Kapak Tasarımının Dili', meta: 'Dergi · Ekim', summary: 'Bir kitabın kapağı okura ne fısıldar?', body: 'Renk, doku ve tipografi; okur daha ilk cümleyi görmeden bir söz verir.' },
  { id: 'o1', kind: 'ozel', title: 'Gölgelerin Mirası: Silinen Sahne', meta: 'Özel · Yazarından', summary: 'Kitaba girmeyen bir bölüm, yalnızca burada.', body: 'Elif o gece armayı ilk kez gördüğünde, aslında yalnız değildi. Kütüphanecinin gözleri karanlıkta parlıyordu.' },
  { id: 'o2', kind: 'ozel', title: 'Altın Pusula Haritası', meta: 'Özel · Ek içerik', summary: 'Yolculuğun geçtiği şehirlerin el çizimi rehberi.', body: 'Liman, eski çarşı, fener ve kayıp köprü. Her durak bir bölümün kapısı.' },
];
