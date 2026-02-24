import 'package:flutter/material.dart';
import 'package:flutter/widgets.dart';

/// A simple home screen widget that displays a welcome message
/// and a list of recent items.
class HomeScreen extends StatelessWidget {
  final String title;
  final List<String> items;

  const HomeScreen({
    super.key,
    required this.title,
    this.items = const [],
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView.builder(
        itemCount: items.length,
        itemBuilder: (context, index) {
          return ListTile(
            title: Text(items[index]),
          );
        },
      ),
    );
  }
}
