import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/auction_card.dart';
import '../../../shared/widgets/common.dart';
import '../../catalog/data/catalog_repository.dart';

/// Search and browse with filters. Results load 20 at a time as you scroll.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key, this.initialCategory, this.initialStatus, this.initialQuery});

  final String? initialCategory;
  final String? initialStatus;
  final String? initialQuery;

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  late final TextEditingController _q = TextEditingController(text: widget.initialQuery);
  final _scroll = ScrollController();
  Timer? _debounce;

  late String _status = widget.initialStatus ?? 'open';
  late String? _category = widget.initialCategory;
  String? _condition;
  String _sort = 'ending_soon';

  final _items = <AuctionCardModel>[];
  int _page = 0;
  bool _hasMore = true;
  bool _loading = false;
  int? _total;
  Object? _error;
  int _generation = 0; // ignore responses from an older query

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 600) _loadMore();
    });
    _reset();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _reset() {
    _generation++;
    setState(() {
      _items.clear();
      _page = 0;
      _hasMore = true;
      _error = null;
      _total = null;
      _loading = false;
    });
    _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loading || !_hasMore) return;
    final gen = _generation;
    setState(() => _loading = true);
    try {
      final page = await ref.read(catalogRepositoryProvider).search(
            status: _status,
            category: _category,
            q: _q.text.trim().isEmpty ? null : _q.text.trim(),
            condition: _condition,
            sort: _status == 'upcoming' ? 'starting_soon' : _sort,
            page: _page + 1,
          );
      if (!mounted || gen != _generation) return;
      setState(() {
        _items.addAll(page.items);
        _page = page.page;
        _hasMore = page.hasMore;
        _total = page.total;
      });
    } on ApiException catch (e) {
      if (mounted && gen == _generation) setState(() => _error = e);
    } finally {
      if (mounted && gen == _generation) setState(() => _loading = false);
    }
  }

  void _onQueryChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _reset);
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final lang = Localizations.localeOf(context).languageCode;
    final categories = ref.watch(categoriesProvider).valueOrNull ?? const <CategoryModel>[];

    Widget chip(String label, bool selected, VoidCallback onTap) =>
        Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(label), selected: selected, onSelected: (_) => onTap()));

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: TextField(
          controller: _q,
          autofocus: widget.initialCategory == null && widget.initialStatus == null,
          textInputAction: TextInputAction.search,
          onChanged: _onQueryChanged,
          onSubmitted: (_) => _reset(),
          decoration: InputDecoration(
            hintText: s.searchHint,
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _q.text.isEmpty ? null : IconButton(icon: const Icon(Icons.clear), onPressed: () { _q.clear(); _reset(); }),
            isDense: true,
          ),
        ),
      ),
      body: Column(children: [
        SizedBox(
          height: 52,
          child: ListView(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), scrollDirection: Axis.horizontal, children: [
            chip(s.statusOpen, _status == 'open', () { _status = 'open'; _reset(); }),
            chip(s.statusLive, _status == 'live', () { _status = 'live'; _reset(); }),
            chip(s.statusUpcoming, _status == 'upcoming', () { _status = 'upcoming'; _reset(); }),
            chip(s.statusEnded, _status == 'ended', () { _status = 'ended'; _reset(); }),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [
            Expanded(
              child: DropdownButtonFormField<String?>(
                value: _category,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
                items: [
                  DropdownMenuItem<String?>(value: null, child: Text(s.allCategories)),
                  for (final c in categories) DropdownMenuItem<String?>(value: c.slug, child: Text(c.name(lang), overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (v) { _category = v; _reset(); },
              ),
            ),
            const SizedBox(width: 8),
            PopupMenuButton<String>(
              tooltip: s.sortBy,
              icon: const Icon(Icons.tune),
              onSelected: (v) {
                if (v.startsWith('cond:')) {
                  _condition = v == 'cond:any' ? null : v.substring(5);
                } else {
                  _sort = v;
                }
                _reset();
              },
              itemBuilder: (_) => [
                for (final (key, label) in [('ending_soon', s.sortEndingSoon), ('newest', s.sortNewest), ('most_bids', s.sortMostBids), ('starting_soon', s.sortStartingSoon)])
                  CheckedPopupMenuItem(value: key, checked: _sort == key, child: Text(label)),
                const PopupMenuDivider(),
                CheckedPopupMenuItem(value: 'cond:any', checked: _condition == null, child: Text(s.anyCondition)),
                for (final c in ['NEW', 'LIKE_NEW', 'USED_GOOD', 'USED_FAIR', 'FOR_PARTS'])
                  CheckedPopupMenuItem(value: 'cond:$c', checked: _condition == c, child: Text(s.condition(c))),
              ],
            ),
          ]),
        ),
        if (_total != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Align(alignment: Alignment.centerLeft, child: Text(s.resultsCount(_total!), style: Theme.of(context).textTheme.bodySmall)),
          ),
        Expanded(child: _results(s)),
      ]),
    );
  }

  Widget _results(S s) {
    if (_error != null && _items.isEmpty) return ErrorState(message: s.error(_error!), onRetry: _reset);
    if (_items.isEmpty && _loading) return const Center(child: CircularProgressIndicator());
    if (_items.isEmpty) return EmptyState(icon: Icons.search_off, title: s.noResults);
    return RefreshIndicator(
      onRefresh: () async => _reset(),
      child: AuctionGrid(
        items: _items,
        controller: _scroll,
        footer: _hasMore ? const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())) : const SizedBox(height: 24),
      ),
    );
  }
}
