import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../catalog/data/catalog_repository.dart';
import '../data/seller_repository.dart';

/// Create or edit a listing: details, up to 3 highlights, a grouped spec sheet and photos.
/// Prices never go here: the price is set on the auction, and cards show no price.
class ListingEditorScreen extends ConsumerStatefulWidget {
  const ListingEditorScreen({super.key, this.productId});
  final String? productId;

  @override
  ConsumerState<ListingEditorScreen> createState() => _ListingEditorScreenState();
}

class _GroupDraft {
  _GroupDraft(String name, List<(String, String)> rows)
      : name = TextEditingController(text: name),
        rows = [for (final (l, v) in rows) (TextEditingController(text: l), TextEditingController(text: v))];

  final TextEditingController name;
  final List<(TextEditingController, TextEditingController)> rows;

  void dispose() {
    name.dispose();
    for (final (l, v) in rows) {
      l.dispose();
      v.dispose();
    }
  }
}

class _ListingEditorScreenState extends ConsumerState<ListingEditorScreen> {
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _location = TextEditingController(text: 'Addis Ababa');
  final _highlights = List.generate(3, (_) => TextEditingController());
  final _groups = <_GroupDraft>[];
  int? _categoryId;
  String _condition = 'NEW';

  ProductModel? _product;
  bool _loading = false;
  bool _saving = false;
  double? _uploadProgress;
  Object? _loadError;
  Map<String, String> _errors = const {};

  SellerRepository get _repo => ref.read(sellerRepositoryProvider);
  bool get _editable => _product?.editable ?? true;

  @override
  void initState() {
    super.initState();
    if (widget.productId != null) {
      _load();
    } else {
      _groups.add(_GroupDraft('General', [('Brand', ''), ('Model', '')]));
    }
  }

  @override
  void dispose() {
    for (final c in [_title, _description, _location, ..._highlights]) {
      c.dispose();
    }
    for (final g in _groups) {
      g.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final p = await _repo.product(widget.productId!);
      if (!mounted) return;
      _fill(p);
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Reload only the server-owned parts (status, photos) without touching unsaved text.
  Future<void> _reloadProduct() async {
    final p = await _repo.product(widget.productId!);
    if (mounted) setState(() => _product = p);
  }

  void _fill(ProductModel p) {
    setState(() {
      _product = p;
      _title.text = p.title;
      _description.text = p.description;
      _location.text = p.location;
      _categoryId = p.categoryId;
      _condition = p.condition;
      for (var i = 0; i < 3; i++) {
        _highlights[i].text = i < p.highlights.length ? p.highlights[i] : '';
      }
      for (final g in _groups) {
        g.dispose();
      }
      _groups
        ..clear()
        ..addAll(p.specs.map((g) => _GroupDraft(g.group, [for (final r in g.rows) (r.label, r.value)])));
      if (_groups.isEmpty) _groups.add(_GroupDraft('General', [('', '')]));
    });
  }

  Json _payload() {
    return {
      'categoryId': _categoryId,
      'title': _title.text.trim(),
      'description': _description.text.trim(),
      'condition': _condition,
      'location': _location.text.trim(),
      'attributes': {
        'highlights': [for (final h in _highlights) if (h.text.trim().isNotEmpty) h.text.trim()],
        'specs': [
          for (final g in _groups)
            if (g.name.text.trim().isNotEmpty)
              {
                'group': g.name.text.trim(),
                'rows': [
                  for (final (l, v) in g.rows)
                    if (l.text.trim().isNotEmpty && v.text.trim().isNotEmpty) {'label': l.text.trim(), 'value': v.text.trim()},
                ],
              },
        ],
      },
    };
  }

  /// Returns true when saved.
  Future<bool> _save({bool quiet = false}) async {
    final s = S.of(context);
    if (!_form.currentState!.validate()) return false;
    setState(() {
      _saving = true;
      _errors = const {};
    });
    try {
      if (_product == null) {
        final created = await _repo.createProduct(_payload());
        if (!mounted) return true;
        ref.invalidate(sellerProductsProvider);
        // Re-open as an existing listing so photos can be added.
        context.pushReplacement('/seller/listings/${created.id}');
        showSnack(context, s.photosAfterSave);
        return true;
      }
      await _repo.updateProduct(_product!.id, _payload());
      await _reloadProduct();
      ref.invalidate(sellerProductsProvider);
      if (mounted && !quiet) showSnack(context, s.profileSaved);
      return true;
    } on ApiException catch (e) {
      if (!mounted) return false;
      setState(() => _errors = e.fieldErrors);
      showSnack(context, e.fieldErrors.isEmpty ? s.error(e) : e.fieldErrors.values.first, error: true);
      return false;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _submit() async {
    final s = S.of(context);
    if (!await _save(quiet: true)) return;
    try {
      await _repo.submitProduct(_product!.id);
      await _reloadProduct();
      ref.invalidate(sellerProductsProvider);
      if (mounted) showSnack(context, s.listingStatus('PENDING_REVIEW'));
    } catch (e) {
      if (mounted) showSnack(context, s.error(e), error: true);
    }
  }

  Future<void> _delete() async {
    final s = S.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text('${s.delete}: ${_title.text}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(s.cancel)),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: AppColors.red), onPressed: () => Navigator.pop(c, true), child: Text(s.delete)),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _repo.deleteProduct(_product!.id);
      ref.invalidate(sellerProductsProvider);
      if (mounted) context.pop();
    } catch (e) {
      if (mounted) showSnack(context, s.error(e), error: true);
    }
  }

  Future<void> _addPhotos() async {
    final s = S.of(context);
    final files = await ImagePicker().pickMultiImage(maxWidth: 2400, imageQuality: 90);
    if (files.isEmpty || !mounted) return;
    setState(() => _uploadProgress = 0);
    try {
      await _repo.uploadImages(_product!.id, files.take(10).toList(), onProgress: (sent, total) {
        if (mounted && total > 0) setState(() => _uploadProgress = sent / total);
      });
      await _reloadProduct();
    } catch (e) {
      if (mounted) showSnack(context, s.error(e), error: true);
    } finally {
      if (mounted) setState(() => _uploadProgress = null);
    }
  }

  Future<void> _deletePhoto(ProductImage img) async {
    final s = S.of(context);
    try {
      await _repo.deleteImage(_product!.id, img.id);
      await _reloadProduct();
    } catch (e) {
      if (mounted) showSnack(context, s.error(e), error: true);
    }
  }

  Future<void> _reorder(int from, int to) async {
    final p = _product!;
    final list = [...p.images];
    if (to > from) to -= 1;
    list.insert(to, list.removeAt(from));
    // Show the new order straight away; the server confirms.
    setState(() => _product = p.withImages(list));
    try {
      await _repo.reorderImages(p.id, [for (final i in list) i.id]);
    } catch (e) {
      if (mounted) showSnack(context, S.of(context).error(e), error: true);
      await _reloadProduct();
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final lang = s.lang;
    final p = _product;
    final categories = ref.watch(categoriesProvider).valueOrNull ?? const <CategoryModel>[];
    final leaves = [for (final c in categories) ...c.leaves];

    if (_loading) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    if (_loadError != null) return Scaffold(appBar: AppBar(), body: ErrorState(message: s.error(_loadError!), onRetry: _load));

    String? need(String? v, [int min = 1]) => (v == null || v.trim().length < min) ? s.requiredField : null;

    return Scaffold(
      appBar: AppBar(
        title: Text(p == null ? s.newListing : s.editListing),
        actions: [
          if (p != null && p.status == 'DRAFT') IconButton(tooltip: s.delete, icon: const Icon(Icons.delete_outline), onPressed: _delete),
        ],
        bottom: _uploadProgress == null ? null : PreferredSize(preferredSize: const Size.fromHeight(4), child: LinearProgressIndicator(value: _uploadProgress)),
      ),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 120), children: [
          if (p != null) ...[
            Row(children: [StatusPill(s.listingStatus(p.status), color: statusColor(p.status))]),
            if (p.rejectionReason != null && p.status == 'REJECTED')
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(s.rejectedBecause(p.rejectionReason!), style: const TextStyle(color: AppColors.red))),
            if (!p.editable && p.lockedReason != null)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(p.lockedReason!, style: Theme.of(context).textTheme.bodySmall)),
            const SizedBox(height: 16),
          ],
          TextFormField(
            controller: _title,
            enabled: _editable,
            maxLength: 200,
            decoration: InputDecoration(labelText: s.title, errorText: _errors['title']),
            validator: (v) => need(v, 5),
          ),
          DropdownButtonFormField<int>(
            value: leaves.any((c) => c.id == _categoryId) ? _categoryId : null,
            isExpanded: true,
            decoration: InputDecoration(labelText: s.category, errorText: _errors['categoryId']),
            items: [for (final c in leaves) DropdownMenuItem(value: c.id, child: Text(c.name(lang), overflow: TextOverflow.ellipsis))],
            onChanged: _editable ? (v) => setState(() => _categoryId = v) : null,
            validator: (v) => v == null ? s.requiredField : null,
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _condition,
            decoration: InputDecoration(labelText: s.conditionLabel),
            items: [for (final c in ['NEW', 'LIKE_NEW', 'USED_GOOD', 'USED_FAIR', 'FOR_PARTS']) DropdownMenuItem(value: c, child: Text(s.condition(c)))],
            onChanged: _editable ? (v) => setState(() => _condition = v!) : null,
          ),
          const SizedBox(height: 12),
          TextFormField(controller: _location, enabled: _editable, decoration: InputDecoration(labelText: s.location, errorText: _errors['location']), validator: (v) => need(v, 2)),
          const SizedBox(height: 12),
          TextFormField(
            controller: _description,
            enabled: _editable,
            minLines: 4,
            maxLines: 10,
            maxLength: 5000,
            decoration: InputDecoration(labelText: s.description, alignLabelWithHint: true, errorText: _errors['description']),
            validator: (v) => need(v, 20),
          ),
          _heading(context, s.highlights, s.highlightsHint),
          for (var i = 0; i < 3; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: TextFormField(
                controller: _highlights[i],
                enabled: _editable,
                maxLength: 28,
                decoration: InputDecoration(labelText: '${s.highlights} ${i + 1}${i == 0 ? '' : ' (${s.optional})'}', counterText: ''),
                validator: i == 0 ? (v) => need(v) : null,
              ),
            ),
          _heading(context, s.specGroups, null),
          for (var gi = 0; gi < _groups.length; gi++) _groupEditor(context, gi),
          if (_editable && _groups.length < 12)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(onPressed: () => setState(() => _groups.add(_GroupDraft('', [('', '')]))), icon: const Icon(Icons.add), label: Text(s.addGroup)),
            ),
          _heading(context, s.photos, p == null ? s.photosAfterSave : null),
          if (p != null) _photos(context, p),
        ]),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Row(children: [
            if (_editable)
              Expanded(
                child: OutlinedButton(
                  onPressed: _saving ? null : () => _save(),
                  child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(s.saveDraft),
                ),
              ),
            if (p != null && (p.status == 'DRAFT' || p.status == 'REJECTED')) ...[
              const SizedBox(width: 12),
              Expanded(child: FilledButton(onPressed: _saving || p.images.isEmpty ? null : _submit, child: Text(s.submitForReview))),
            ],
            if (p != null && p.canAuction) ...[
              const SizedBox(width: 12),
              Expanded(child: FilledButton.icon(onPressed: () => context.push('/seller/auctions/new?productId=${p.id}'), icon: const Icon(Icons.gavel), label: Text(s.scheduleAuction))),
            ],
          ]),
        ),
      ),
    );
  }

  Widget _heading(BuildContext context, String title, String? hint) => Padding(
        padding: const EdgeInsets.only(top: 20, bottom: 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          if (hint != null) Text(hint, style: Theme.of(context).textTheme.bodySmall),
        ]),
      );

  Widget _groupEditor(BuildContext context, int gi) {
    final s = S.of(context);
    final g = _groups[gi];
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 4, 8),
        child: Column(children: [
          Row(children: [
            Expanded(child: TextFormField(controller: g.name, enabled: _editable, maxLength: 40, decoration: InputDecoration(labelText: s.groupName, counterText: ''))),
            if (_editable && _groups.length > 1)
              IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () => setState(() => _groups.removeAt(gi).dispose()),
              ),
          ]),
          for (var ri = 0; ri < g.rows.length; ri++)
            Row(children: [
              Expanded(flex: 2, child: TextFormField(controller: g.rows[ri].$1, enabled: _editable, maxLength: 40, decoration: InputDecoration(labelText: s.label, counterText: ''))),
              const SizedBox(width: 8),
              Expanded(flex: 3, child: TextFormField(controller: g.rows[ri].$2, enabled: _editable, maxLength: 120, decoration: InputDecoration(labelText: s.value, counterText: ''))),
              if (_editable && g.rows.length > 1)
                IconButton(
                  icon: const Icon(Icons.remove_circle_outline),
                  onPressed: () => setState(() {
                    final (l, v) = g.rows.removeAt(ri);
                    l.dispose();
                    v.dispose();
                  }),
                )
              else
                const SizedBox(width: 8),
            ]),
          if (_editable && g.rows.length < 20)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => setState(() => g.rows.add((TextEditingController(), TextEditingController()))),
                icon: const Icon(Icons.add, size: 18),
                label: Text(s.addRow),
              ),
            ),
        ]),
      ),
    );
  }

  Widget _photos(BuildContext context, ProductModel p) {
    final s = S.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (p.images.isNotEmpty)
        SizedBox(
          height: 120,
          child: ReorderableListView.builder(
            scrollDirection: Axis.horizontal,
            buildDefaultDragHandles: _editable,
            itemCount: p.images.length,
            onReorder: (from, to) {
              if (_editable) _reorder(from, to);
            },
            itemBuilder: (_, i) {
              final img = p.images[i];
              return Padding(
                key: ValueKey(img.id),
                padding: const EdgeInsets.only(right: 8),
                child: Stack(children: [
                  ClipRRect(borderRadius: BorderRadius.circular(10), child: SizedBox(width: 120, height: 120, child: AppNetworkImage(url: img.urls.sm))),
                  if (i == 0)
                    Positioned(left: 6, top: 6, child: StatusPill('1', color: AppColors.amber)),
                  if (_editable)
                    Positioned(
                      right: 0,
                      top: 0,
                      child: IconButton.filledTonal(visualDensity: VisualDensity.compact, icon: const Icon(Icons.close, size: 16), onPressed: () => _deletePhoto(img)),
                    ),
                ]),
              );
            },
          ),
        ),
      const SizedBox(height: 8),
      if (_editable)
        OutlinedButton.icon(onPressed: _uploadProgress == null ? _addPhotos : null, icon: const Icon(Icons.add_photo_alternate_outlined), label: Text(s.addPhotos)),
    ]);
  }
}
