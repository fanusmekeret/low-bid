import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../data/seller_repository.dart';

const documentTypes = ['FAYDA_ID', 'KEBELE_ID', 'PASSPORT', 'DRIVING_LICENSE', 'TRADE_LICENSE', 'TIN_CERTIFICATE'];

/// Upload ID and business documents for seller review. Files go to private storage.
class SellerDocumentsScreen extends ConsumerStatefulWidget {
  const SellerDocumentsScreen({super.key});

  @override
  ConsumerState<SellerDocumentsScreen> createState() => _SellerDocumentsScreenState();
}

class _SellerDocumentsScreenState extends ConsumerState<SellerDocumentsScreen> {
  double? _progress;

  Future<void> _upload() async {
    final s = S.of(context);
    final type = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text(s.documentType, style: Theme.of(c).textTheme.titleMedium)),
          for (final t in documentTypes) ListTile(title: Text(s.document(t)), onTap: () => Navigator.pop(c, t)),
        ]),
      ),
    );
    if (type == null || !mounted) return;
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(s.camera), onTap: () => Navigator.pop(c, ImageSource.camera)),
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(s.gallery), onTap: () => Navigator.pop(c, ImageSource.gallery)),
        ]),
      ),
    );
    if (source == null) return;
    final file = await ImagePicker().pickImage(source: source, maxWidth: 2400, imageQuality: 88);
    if (file == null || !mounted) return;
    setState(() => _progress = 0);
    try {
      await ref.read(sellerRepositoryProvider).uploadDocument(type, file, onProgress: (sent, total) {
        if (mounted && total > 0) setState(() => _progress = sent / total);
      });
      ref.invalidate(sellerProfileProvider);
    } catch (e) {
      if (mounted) showSnack(context, s.error(e), error: true);
    } finally {
      if (mounted) setState(() => _progress = null);
    }
  }

  Future<void> _delete(SellerDocument d) async {
    final s = S.of(context);
    try {
      await ref.read(sellerRepositoryProvider).deleteDocument(d.id);
      ref.invalidate(sellerProfileProvider);
    } catch (e) {
      if (mounted) showSnack(context, s.error(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(s.documents),
        bottom: _progress == null ? null : PreferredSize(preferredSize: const Size.fromHeight(4), child: LinearProgressIndicator(value: _progress)),
      ),
      floatingActionButton: FloatingActionButton.extended(onPressed: _progress == null ? _upload : null, icon: const Icon(Icons.upload_file), label: Text(s.uploadDocument)),
      body: AsyncValueView<SellerProfileModel?>(
        value: ref.watch(sellerProfileProvider),
        onRetry: () => ref.invalidate(sellerProfileProvider),
        data: (p) {
          if (p == null) return EmptyState(icon: Icons.storefront_outlined, title: s.becomeSeller);
          return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 96), children: [
            if (p.missing.isNotEmpty)
              Card(
                margin: const EdgeInsets.only(bottom: 16),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(s.missingDocuments, style: const TextStyle(fontWeight: FontWeight.w700)),
                    for (final m in p.missing) Padding(padding: const EdgeInsets.only(top: 4), child: Text('• ${s.missing(m)}')),
                  ]),
                ),
              ),
            if (p.documents.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(s.nothingHere))),
            for (final d in p.documents)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: Text(s.document(d.documentType)),
                  subtitle: d.rejectionReason == null ? null : Text(s.rejectedBecause(d.rejectionReason!)),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    StatusPill(s.docStatus(d.status), color: statusColor(d.status)),
                    if (d.status != 'APPROVED') IconButton(tooltip: s.delete, icon: const Icon(Icons.delete_outline), onPressed: () => _delete(d)),
                  ]),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
