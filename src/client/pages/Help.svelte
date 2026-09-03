<script lang="ts">
  // Halaman panduan penggunaan — statis, ringan, tanpa API
</script>

<main class="help-page">
  <header>
    <a class="back" href="#/">‹ Proyek</a>
    <h1>Panduan</h1>
  </header>

  <article>
    <section>
      <h2>Mulai Cepat</h2>
      <ol>
        <li>Di halaman <strong>Proyek</strong>, ketik nama lalu <kbd>Enter</kbd> — project baru dibuat lengkap dengan 3 kolom default (Backlog, Sedang Dikerjakan, Selesai) dan langsung terbuka.</li>
        <li>Di board, ketik di kotak <em>＋ tugas</em> bawah kolom lalu <kbd>Enter</kbd> untuk menambah kartu.</li>
        <li>Seret kartu antar kolom untuk memindah, atau klik <strong>✓</strong> di kanan kartu untuk langsung menandai selesai.</li>
      </ol>
    </section>

    <section>
      <h2>Proyek (Dashboard)</h2>
      <ul>
        <li><strong>＋ tugas</strong> — tambah tugas cepat ke project tanpa membuka board; pilih kolom tujuan di dropdown.</li>
        <li><strong>Arsipkan</strong> — sembunyikan project yang selesai/tidak aktif. Datanya tetap utuh, hanya tidak tampil di daftar.</li>
        <li><strong>Hapus</strong> — hapus permanen project beserta semua tugas dan kolomnya. Tidak bisa di-undo.</li>
        <li><strong>▸ Arsip</strong> (paling bawah) — buka untuk melihat project terarsip. Klik nama atau <em>Pulihkan</em> untuk mengaktifkan kembali; <em>Hapus permanen</em> untuk membuang selamanya.</li>
      </ul>
    </section>

    <section>
      <h2>Board &amp; Kolom</h2>
      <ul>
        <li><strong>Klik nama kolom</strong> untuk ganti nama.</li>
        <li><em>tandai selesai</em> — menandai kolom sebagai kolom penyelesaian; tugas di dalamnya tidak dihitung sebagai "aktif".</li>
        <li><em>hapus</em> — hapus kolom beserta tugas di dalamnya (ada konfirmasi).</li>
        <li><strong>＋ kolom</strong> di kanan board — tambah kolom baru.</li>
        <li>Seret kolom untuk mengubah urutannya.</li>
      </ul>
    </section>

    <section>
      <h2>Kartu Tugas</h2>
      <ul>
        <li><strong>Klik kartu</strong> untuk membuka detail: judul, catatan, prioritas (rendah/sedang/tinggi), dan tenggat.</li>
        <li><strong>Checklist</strong> di panel detail — pecah tugas besar jadi langkah-langkah; centang tiap langkah, progress bar mengikuti.</li>
        <li>Tombol <strong>✓</strong> di kanan kartu = pindahkan sekali klik ke kolom Selesai.</li>
        <li>Kartu dengan tenggat mendapat warna: <span class="tag-soon">kuning = tenggat ≤ 2 hari</span>, <span class="tag-over">merah = sudah lewat tenggat</span>.</li>
      </ul>
    </section>

    <section>
      <h2>Filter &amp; Urutkan</h2>
      <ul>
        <li><strong>Prioritas</strong> — tampilkan hanya kartu dengan prioritas tertentu. Ini hanya tampilan; data tidak berubah.</li>
        <li><strong>Urutkan</strong> — <em>Manual</em> (hasil seret), <em>Tenggat</em> (terdekat di atas), atau <em>Prioritas</em> (tertinggi di atas).</li>
        <li>Urutan hasil filter/sort tidak disimpan ke server sampai kamu menyeret kartu.</li>
      </ul>
    </section>

    <section>
      <h2>🔁 Task Berulang</h2>
      <ul>
        <li>Klik <strong>🔁 Recurring</strong> di header board → panel samping terbuka.</li>
        <li>Buat pola: <em>harian</em> (setiap N hari), <em>mingguan</em> (hari tertentu), atau <em>bulanan</em> (tanggal tertentu).</li>
        <li>Setiap hari, task sesuai pola otomatis masuk ke kolom yang dipilih — sekali per hari, tanpa duplikat.</li>
        <li><strong>✓ / ○</strong> — aktif/nonaktifkan pola tanpa menghapusnya.</li>
      </ul>
    </section>

    <section>
      <h2>Cari</h2>
      <ul>
        <li>Klik ikon 🔍 di kanan atas dashboard (atau tekan <kbd>/</kbd>), ketik minimal 2 huruf.</li>
        <li>Mencari di judul <em>dan</em> catatan, lintas semua project aktif. Klik hasil untuk melompat ke board-nya.</li>
      </ul>
    </section>

    <section>
      <h2>Pinturan Keyboard</h2>
      <table>
        <tbody>
          <tr><td><kbd>n</kbd></td><td>Fokus ke input tugas baru (board) / project baru (dashboard)</td></tr>
          <tr><td><kbd>/</kbd></td><td>Buka pencarian (dashboard)</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Tutup panel detail / pencarian / rename</td></tr>
        </tbody>
      </table>
      <p class="note">Pinturan nonaktif saat kursor sedang berada di dalam kolom teks.</p>
    </section>

    <section>
      <h2>Catatan Teknis</h2>
      <ul>
        <li>Akses lewat <code>kanban.aspadani.id</code> — login Google, hanya akun pemilik yang boleh masuk (Cloudflare Access).</li>
        <li>Data tersimpan di D1 (Cloudflare). Tidak ada sinkronisasi lintas perangkat yang perlu dikhawatirkan — semua real-time dari server.</li>
        <li>Bisa dipakai di HP; board menumpuk vertikal di layar kecil.</li>
      </ul>
    </section>
  </article>
</main>

<style>
  .help-page {
    min-height: 100vh;
    background: var(--bg, #fafafa);
    color: #171717;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    padding: 1.25rem 1.5rem 0.5rem;
    max-width: 44rem;
    margin: 0 auto;
  }
  .back {
    color: #525252;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .back:hover {
    color: #171717;
  }
  h1 {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0;
  }
  article {
    max-width: 44rem;
    margin: 0 auto;
    padding: 0.5rem 1.5rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  section {
    padding: 0.75rem 0;
    border-bottom: 1px solid #ececec;
  }
  section:last-child {
    border-bottom: none;
  }
  h2 {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }
  ul,
  ol {
    margin: 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  li {
    font-size: 0.9rem;
    line-height: 1.55;
  }
  strong {
    font-weight: 600;
  }
  kbd {
    display: inline-block;
    background: #fff;
    border: 1px solid #d4d4d4;
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 0.35rem;
    font-family: inherit;
    font-size: 0.8rem;
    line-height: 1.5;
  }
  code {
    background: #f0f0f0;
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
    font-size: 0.82rem;
  }
  table {
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  td {
    padding: 0.3rem 1rem 0.3rem 0;
    vertical-align: top;
  }
  .tag-soon,
  .tag-over {
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .tag-soon {
    background: #fffbeb;
    color: #b45309;
  }
  .tag-over {
    background: #fef2f2;
    color: #dc2626;
  }
  .note {
    color: #737373;
    font-size: 0.82rem;
    margin: 0.5rem 0 0;
  }
</style>
